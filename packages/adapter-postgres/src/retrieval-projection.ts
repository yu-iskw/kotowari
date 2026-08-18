import { claimText } from '@kotowari/plugin-sdk';

import { AdapterPostgresError } from './errors.js';

import type { SqlClient } from './sql-client.js';
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

const PROJECTION_ID = 'postgres-retrieval-v1' as const;
const CLAIM_ASSERTED_EVENT = 'claim.asserted' as const;
const CLAIM_RETRACTED_EVENT = 'claim.retracted' as const;
const ENTITY_MERGED_EVENT = 'entity.merged' as const;
const ENTITY_MERGE_REVERTED_EVENT = 'entity.merge_reverted' as const;
const CLAIM_EVENT_KINDS = [CLAIM_ASSERTED_EVENT, CLAIM_RETRACTED_EVENT] as const;
const ENTITY_IDENTITY_EVENT_KINDS = [ENTITY_MERGED_EVENT, ENTITY_MERGE_REVERTED_EVENT] as const;
const RELEVANT_EVENT_KINDS = new Set<DomainEvent['kind']>([
  ...CLAIM_EVENT_KINDS,
  ...ENTITY_IDENTITY_EVENT_KINDS,
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
        left.occurredAt.localeCompare(right.occurredAt) ||
        left.eventId.localeCompare(right.eventId),
    );
}

function canonicalEntityResolver(events: readonly DomainEvent[]): (id: EntityId) => EntityId {
  const reverted = new Set(
    events
      .filter((event) => event.kind === ENTITY_MERGE_REVERTED_EVENT)
      .map((event) => event.mergeEventId),
  );
  const redirects = new Map<EntityId, EntityId>();
  for (const event of events) {
    if (event.kind !== ENTITY_MERGED_EVENT || reverted.has(event.eventId)) {
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

async function seedGraphEntities(
  sql: SqlClient,
  seedClaimIds: readonly ClaimId[],
): Promise<Set<string>> {
  const entities = new Set<string>();
  for (const claimId of seedClaimIds) {
    const row = (
      await sql.query<ProjectionRow>(
        'SELECT claim_id, subject_id, object_entity_id, vector FROM retrieval_projection WHERE claim_id = $1',
        [claimId],
      )
    )[0];
    if (row === undefined) {
      continue;
    }
    entities.add(row.subject_id);
    if (row.object_entity_id !== null) {
      entities.add(row.object_entity_id);
    }
  }
  return entities;
}

async function graphRowsForEntity(
  sql: SqlClient,
  request: RetrievalCandidateRequest,
  entityId: string,
): Promise<readonly ProjectionRow[]> {
  const validAt = request.temporal?.validAt;
  if (request.namespaceId === undefined) {
    const params: unknown[] = [request.tenantId, entityId];
    const temporal =
      validAt === undefined
        ? ''
        : (params.push(validAt), ' AND valid_from <= $3 AND (valid_to IS NULL OR $3 < valid_to)');
    return sql.query<ProjectionRow>(
      `SELECT claim_id, subject_id, object_entity_id, vector
       FROM retrieval_projection
       WHERE tenant_id = $1
         AND (subject_id = $2 OR object_entity_id = $2)${temporal}`,
      params,
    );
  }
  const params: unknown[] = [request.tenantId, request.namespaceId, entityId];
  const temporal =
    validAt === undefined
      ? ''
      : (params.push(validAt), ' AND valid_from <= $4 AND (valid_to IS NULL OR $4 < valid_to)');
  return sql.query<ProjectionRow>(
    `SELECT claim_id, subject_id, object_entity_id, vector
     FROM retrieval_projection
     WHERE tenant_id = $1 AND namespace_id = $2
       AND (subject_id = $3 OR object_entity_id = $3)${temporal}`,
    params,
  );
}

function collectGraphRows(input: {
  rows: readonly ProjectionRow[];
  entityId: string;
  hop: number;
  seenClaims: Set<ClaimId>;
  candidates: Map<ClaimId, RetrievalCandidate>;
}): Set<string> {
  const next = new Set<string>();
  for (const row of input.rows) {
    const claimId = row.claim_id as ClaimId;
    if (!input.seenClaims.has(claimId)) {
      input.seenClaims.add(claimId);
      input.candidates.set(claimId, {
        claimId,
        score: 1 / input.hop,
        graphRoute: [input.entityId],
      });
    }
    if (row.subject_id !== input.entityId) {
      next.add(row.subject_id);
    }
    if (row.object_entity_id !== null && row.object_entity_id !== input.entityId) {
      next.add(row.object_entity_id);
    }
  }
  return next;
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
            (
              event,
            ): event is Extract<
              DomainEvent,
              { kind: typeof CLAIM_ASSERTED_EVENT | typeof CLAIM_RETRACTED_EVENT }
            > => event.kind === CLAIM_ASSERTED_EVENT || event.kind === CLAIM_RETRACTED_EVENT,
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
    if (
      pending.some(
        (event) => event.kind === ENTITY_MERGED_EVENT || event.kind === ENTITY_MERGE_REVERTED_EVENT,
      )
    ) {
      await this.rebuild();
      return;
    }

    const resolveEntity = canonicalEntityResolver(events);
    const claimEvents = pending.filter(
      (
        event,
      ): event is Extract<
        DomainEvent,
        { kind: typeof CLAIM_ASSERTED_EVENT | typeof CLAIM_RETRACTED_EVENT }
      > => event.kind === CLAIM_ASSERTED_EVENT || event.kind === CLAIM_RETRACTED_EVENT,
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
    const queryVector = request.queryVector;
    if (queryVector === undefined) {
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
        score: cosine(queryVector, parseVector(row.vector)),
      }))
      .sort((left, right) => right.score - left.score || left.claimId.localeCompare(right.claimId))
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
    let frontier = await seedGraphEntities(this.sql, seedClaimIds);
    const candidates = new Map<ClaimId, RetrievalCandidate>();

    for (let hop = 1; hop <= hops && frontier.size > 0; hop += 1) {
      const next = new Set<string>();
      for (const entityId of frontier) {
        const rows = await graphRowsForEntity(this.sql, request, entityId);
        for (const value of collectGraphRows({ rows, entityId, hop, seenClaims, candidates })) {
          next.add(value);
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
