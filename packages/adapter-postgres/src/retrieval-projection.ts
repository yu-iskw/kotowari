import { claimText } from '@kotowari/plugin-sdk';

import { AdapterPostgresError } from './errors.js';

import type {
  CanonicalStore,
  Claim,
  ClaimId,
  DomainEvent,
  EmbeddingProvider,
  EntityId,
  RetrievalCandidate,
  RetrievalCandidateRequest,
  RetrievalCandidateSource,
} from '@kotowari/plugin-sdk';
import type { SqlClient } from './sql-client.js';

const PROJECTION_ID = 'postgres-retrieval-v1' as const;
const RELEVANT_EVENT_KINDS = new Set<DomainEvent['kind']>([
  'claim.asserted',
  'claim.retracted',
  'entity.merged',
  'entity.merge_reverted',
]);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS retrieval_projection (
  claim_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  namespace_id TEXT,
  body TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  object_entity_id TEXT,
  vector TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  search_vector tsvector NOT NULL
);
CREATE INDEX IF NOT EXISTS retrieval_projection_fts
  ON retrieval_projection USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS retrieval_projection_subject
  ON retrieval_projection (tenant_id, namespace_id, subject_id);
CREATE INDEX IF NOT EXISTS retrieval_projection_object_entity
  ON retrieval_projection (tenant_id, namespace_id, object_entity_id);
CREATE TABLE IF NOT EXISTS retrieval_projection_events (
  projection_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  PRIMARY KEY (projection_id, event_id)
);
CREATE TABLE IF NOT EXISTS retrieval_projection_meta (
  projection_id TEXT PRIMARY KEY,
  synced_at TEXT NOT NULL
);
`;

type ProjectionRow = {
  claim_id: string;
  subject_id: string;
  object_entity_id: string | null;
  vector: string;
};

type ScoredRow = { claim_id: string; score: number };
type ProcessedEventRow = { event_id: string };
type MetaRow = { synced_at: string };

export type RetrievalProjectionStatus = {
  projectionId: string;
  syncedAt?: string;
  latestRelevantEventAt?: string;
  pendingEvents: number;
  stale: boolean;
};

export interface PostgresRetrievalProjection extends RetrievalCandidateSource {
  rebuild(): Promise<void>;
  sync(): Promise<void>;
  status(): Promise<RetrievalProjectionStatus>;
}

function parseVector(value: string): readonly number[] {
  return JSON.parse(value) as readonly number[];
}

function cosine(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function relevantEvents(events: readonly DomainEvent[]): readonly DomainEvent[] {
  return events
    .filter((event) => RELEVANT_EVENT_KINDS.has(event.kind))
    .sort(
      (left, right) =>
        left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId),
    );
}

function canonicalEntityResolver(events: readonly DomainEvent[]): (id: EntityId) => EntityId {
  const reverted = new Set(
    events
      .filter((event) => event.kind === 'entity.merge_reverted')
      .map((event) => event.mergeEventId),
  );
  const redirects = new Map<EntityId, EntityId>();
  for (const event of events) {
    if (event.kind !== 'entity.merged' || reverted.has(event.eventId)) {
      continue;
    }
    for (const absorbed of event.absorbedEntityIds) {
      redirects.set(absorbed, event.survivingEntityId);
    }
  }
  return (id) => {
    let current = id;
    const seen = new Set<EntityId>();
    while (!seen.has(current)) {
      seen.add(current);
      const next = redirects.get(current);
      if (next === undefined) {
        return current;
      }
      current = next;
    }
    return current;
  };
}

function temporalSql(request: RetrievalCandidateRequest, params: unknown[]): string {
  const validAt = request.temporal?.validAt;
  if (validAt === undefined) {
    return '';
  }
  params.push(validAt);
  const index = params.length;
  return ` AND valid_from <= $${index} AND (valid_to IS NULL OR $${index} < valid_to)`;
}

function scopeSql(request: RetrievalCandidateRequest, params: unknown[]): string {
  params.push(request.tenantId);
  let sql = `tenant_id = $${params.length}`;
  if (request.namespaceId !== undefined) {
    params.push(request.namespaceId);
    sql += ` AND namespace_id = $${params.length}`;
  }
  return sql;
}

class RetrievalProjection implements PostgresRetrievalProjection {
  readonly id = PROJECTION_ID;
  private readonly ready: Promise<void>;

  constructor(
    private readonly sql: SqlClient,
    private readonly store: CanonicalStore,
    private readonly embeddings: EmbeddingProvider,
  ) {
    this.ready = this.sql.exec(SCHEMA);
  }

  async rebuild(): Promise<void> {
    await this.ready;
    const events = relevantEvents(await this.store.listEvents());
    const claimIds = [
      ...new Set(
        events
          .filter(
            (event): event is Extract<DomainEvent, { kind: 'claim.asserted' | 'claim.retracted' }> =>
              event.kind === 'claim.asserted' || event.kind === 'claim.retracted',
          )
          .map((event) => event.claimId),
      ),
    ];
    const claims = (
      await Promise.all(claimIds.map(async (claimId) => this.store.getClaim(claimId)))
    ).filter((claim): claim is Claim => claim !== undefined && claim.status !== 'retracted');
    const resolveEntity = canonicalEntityResolver(events);
    const texts = claims.map(claimText);
    const vectors = texts.length === 0 ? [] : (await this.embeddings.embed({ texts })).vectors;

    await this.sql.withTransaction(async (tx) => {
      await tx.exec('DELETE FROM retrieval_projection');
      await tx.query('DELETE FROM retrieval_projection_events WHERE projection_id = $1', [this.id]);
      for (const [index, claim] of claims.entries()) {
        await this.upsertClaim(tx, claim, vectors[index] ?? [], resolveEntity);
      }
      for (const event of events) {
        await this.markProcessed(tx, event);
      }
      await this.markSynced(tx);
    });
  }

  async sync(): Promise<void> {
    await this.ready;
    const events = relevantEvents(await this.store.listEvents());
    const processedRows = await this.sql.query<ProcessedEventRow>(
      'SELECT event_id FROM retrieval_projection_events WHERE projection_id = $1',
      [this.id],
    );
    const processed = new Set(processedRows.map((row) => row.event_id));
    const pending = events.filter((event) => !processed.has(event.eventId));
    if (pending.length === 0) {
      return;
    }
    if (pending.some((event) => event.kind === 'entity.merged' || event.kind === 'entity.merge_reverted')) {
      await this.rebuild();
      return;
    }

    const resolveEntity = canonicalEntityResolver(events);
    const claimEvents = pending.filter(
      (event): event is Extract<DomainEvent, { kind: 'claim.asserted' | 'claim.retracted' }> =>
        event.kind === 'claim.asserted' || event.kind === 'claim.retracted',
    );
    const claimIds = [...new Set(claimEvents.map((event) => event.claimId))];
    const claims = await Promise.all(claimIds.map(async (claimId) => this.store.getClaim(claimId)));
    const activeClaims = claims.filter(
      (claim): claim is Claim => claim !== undefined && claim.status !== 'retracted',
    );
    const vectors =
      activeClaims.length === 0
        ? []
        : (await this.embeddings.embed({ texts: activeClaims.map(claimText) })).vectors;
    const vectorByClaimId = new Map(
      activeClaims.map((claim, index) => [claim.id, vectors[index] ?? []] as const),
    );

    await this.sql.withTransaction(async (tx) => {
      for (const [index, claimId] of claimIds.entries()) {
        const claim = claims[index];
        if (claim === undefined || claim.status === 'retracted') {
          await tx.query('DELETE FROM retrieval_projection WHERE claim_id = $1', [claimId]);
        } else {
          await this.upsertClaim(tx, claim, vectorByClaimId.get(claim.id) ?? [], resolveEntity);
        }
      }
      for (const event of pending) {
        await this.markProcessed(tx, event);
      }
      await this.markSynced(tx);
    });
  }

  async status(): Promise<RetrievalProjectionStatus> {
    await this.ready;
    const events = relevantEvents(await this.store.listEvents());
    const processedRows = await this.sql.query<ProcessedEventRow>(
      'SELECT event_id FROM retrieval_projection_events WHERE projection_id = $1',
      [this.id],
    );
    const processed = new Set(processedRows.map((row) => row.event_id));
    const pendingEvents = events.filter((event) => !processed.has(event.eventId)).length;
    const meta = (
      await this.sql.query<MetaRow>(
        'SELECT synced_at FROM retrieval_projection_meta WHERE projection_id = $1',
        [this.id],
      )
    )[0];
    const latest = events.at(-1)?.occurredAt;
    return {
      projectionId: this.id,
      ...(meta === undefined ? {} : { syncedAt: meta.synced_at }),
      ...(latest === undefined ? {} : { latestRelevantEventAt: latest }),
      pendingEvents,
      stale: pendingEvents > 0,
    };
  }

  async search(request: RetrievalCandidateRequest): Promise<readonly RetrievalCandidate[]> {
    await this.ready;
    if (request.temporal?.knownAt !== undefined) {
      throw new AdapterPostgresError(
        'Postgres retrieval projection supports current-knowledge reads only; use canonical retrieval for knownAt queries',
      );
    }
    if (request.strategy === 'lexical') {
      return this.searchLexical(request);
    }
    if (request.strategy === 'vector') {
      return this.searchVector(request);
    }
    return this.searchGraph(request);
  }

  private async searchLexical(
    request: RetrievalCandidateRequest,
  ): Promise<readonly RetrievalCandidate[]> {
    const params: unknown[] = [request.query];
    const scope = scopeSql(request, params);
    const temporal = temporalSql(request, params);
    params.push(request.limit);
    const rows = await this.sql.query<ScoredRow>(
      `SELECT claim_id, ts_rank(search_vector, plainto_tsquery('simple', $1)) AS score
       FROM retrieval_projection
       WHERE ${scope}${temporal}
         AND search_vector @@ plainto_tsquery('simple', $1)
       ORDER BY score DESC, claim_id
       LIMIT $${params.length}`,
      params,
    );
    return rows.map((row) => ({ claimId: row.claim_id as ClaimId, score: Number(row.score) }));
  }

  private async searchVector(
    request: RetrievalCandidateRequest,
  ): Promise<readonly RetrievalCandidate[]> {
    if (request.queryVector === undefined) {
      throw new AdapterPostgresError('Vector candidate search requires queryVector');
    }
    const params: unknown[] = [];
    const scope = scopeSql(request, params);
    const temporal = temporalSql(request, params);
    const rows = await this.sql.query<ProjectionRow>(
      `SELECT claim_id, subject_id, object_entity_id, vector
       FROM retrieval_projection WHERE ${scope}${temporal}`,
      params,
    );
    return rows
      .map((row) => ({
        claimId: row.claim_id as ClaimId,
        score: cosine(request.queryVector ?? [], parseVector(row.vector)),
      }))
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0) || left.claimId.localeCompare(right.claimId))
      .slice(0, request.limit);
  }

  private async searchGraph(
    request: RetrievalCandidateRequest,
  ): Promise<readonly RetrievalCandidate[]> {
    const seedClaimIds = request.seedClaimIds ?? [];
    const hops = Math.max(0, request.hops ?? 0);
    if (seedClaimIds.length === 0 || hops === 0) {
      return [];
    }
    const seenClaims = new Set<ClaimId>(seedClaimIds);
    let frontier = new Set<string>();
    for (const claimId of seedClaimIds) {
      const rows = await this.sql.query<ProjectionRow>(
        'SELECT claim_id, subject_id, object_entity_id, vector FROM retrieval_projection WHERE claim_id = $1',
        [claimId],
      );
      const row = rows[0];
      if (row !== undefined) {
        frontier.add(row.subject_id);
        if (row.object_entity_id !== null) {
          frontier.add(row.object_entity_id);
        }
      }
    }

    const candidates = new Map<ClaimId, RetrievalCandidate>();
    for (let hop = 1; hop <= hops && frontier.size > 0; hop += 1) {
      const next = new Set<string>();
      for (const entityId of frontier) {
        const params: unknown[] = [];
        const scope = scopeSql(request, params);
        params.push(entityId);
        const entityIndex = params.length;
        const temporal = temporalSql(request, params);
        const rows = await this.sql.query<ProjectionRow>(
          `SELECT claim_id, subject_id, object_entity_id, vector
           FROM retrieval_projection
           WHERE ${scope}${temporal}
             AND (subject_id = $${entityIndex} OR object_entity_id = $${entityIndex})`,
          params,
        );
        for (const row of rows) {
          const claimId = row.claim_id as ClaimId;
          if (!seenClaims.has(claimId)) {
            seenClaims.add(claimId);
            candidates.set(claimId, { claimId, score: 1 / hop, graphRoute: [entityId] });
          }
          if (row.subject_id !== entityId) {
            next.add(row.subject_id);
          }
          if (row.object_entity_id !== null && row.object_entity_id !== entityId) {
            next.add(row.object_entity_id);
          }
        }
      }
      frontier = next;
      if (candidates.size >= request.limit) {
        break;
      }
    }
    return [...candidates.values()].slice(0, request.limit);
  }

  private async upsertClaim(
    sql: SqlClient,
    claim: Claim,
    vector: readonly number[],
    resolveEntity: (id: EntityId) => EntityId,
  ): Promise<void> {
    const subjectId = resolveEntity(claim.subject);
    const objectEntityId =
      claim.object.kind === 'entity' ? resolveEntity(claim.object.entityId) : undefined;
    const body = claimText(claim);
    await sql.query(
      `INSERT INTO retrieval_projection
       (claim_id, tenant_id, namespace_id, body, subject_id, object_entity_id, vector, valid_from, valid_to, search_vector)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_tsvector('simple', $4))
       ON CONFLICT (claim_id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         namespace_id = EXCLUDED.namespace_id,
         body = EXCLUDED.body,
         subject_id = EXCLUDED.subject_id,
         object_entity_id = EXCLUDED.object_entity_id,
         vector = EXCLUDED.vector,
         valid_from = EXCLUDED.valid_from,
         valid_to = EXCLUDED.valid_to,
         search_vector = EXCLUDED.search_vector`,
      [
        claim.id,
        claim.tenantId,
        claim.namespaceId,
        body,
        subjectId,
        objectEntityId ?? null,
        JSON.stringify(vector),
        claim.bitemporal.validFrom,
        claim.bitemporal.validTo ?? null,
      ],
    );
  }

  private async markProcessed(sql: SqlClient, event: DomainEvent): Promise<void> {
    await sql.query(
      `INSERT INTO retrieval_projection_events (projection_id, event_id, occurred_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (projection_id, event_id) DO NOTHING`,
      [this.id, event.eventId, event.occurredAt],
    );
  }

  private async markSynced(sql: SqlClient): Promise<void> {
    await sql.query(
      `INSERT INTO retrieval_projection_meta (projection_id, synced_at)
       VALUES ($1, $2)
       ON CONFLICT (projection_id) DO UPDATE SET synced_at = EXCLUDED.synced_at`,
      [this.id, new Date().toISOString()],
    );
  }
}

export function createPostgresRetrievalProjection(input: {
  sql: SqlClient;
  store: CanonicalStore;
  embeddings: EmbeddingProvider;
}): PostgresRetrievalProjection {
  return new RetrievalProjection(input.sql, input.store, input.embeddings);
}
