import {
  claimText,
  claimVisibleAt,
  normalizeTemporalPerspective,
  postgresFtsQuery,
} from '@kotowari/plugin-sdk';

import { createPgPoolClient, createPgliteClient } from './sql-client.js';

import type { SqlClient } from './sql-client.js';
import type {
  CanonicalStore,
  Claim,
  ClaimId,
  ClaimReadFilter,
  Conflict,
  ConflictResolution,
  ContextId,
  ContextSnapshot,
  Decision,
  DecisionId,
  DomainEvent,
  Entity,
  EntityId,
  EventId,
  Evidence,
  EvidenceId,
  MemoryRecord,
  NamespaceId,
  PolicyId,
  PolicyRecord,
  RetrievalReceipt,
  RetrievalReceiptId,
  TenantId,
} from '@kotowari/plugin-sdk';

const COLLECTIONS = {
  entities: 'entities',
  evidence: 'evidence',
  claims: 'claims',
  decisions: 'decisions',
  snapshots: 'snapshots',
  retrievalReceipts: 'retrieval_receipts',
  memory: 'memory',
  policies: 'policies',
  conflicts: 'conflicts',
  resolutions: 'resolutions',
} as const;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS records (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  namespace_id TEXT,
  payload TEXT NOT NULL,
  PRIMARY KEY (collection, id)
);
CREATE TABLE IF NOT EXISTS record_history (
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  namespace_id TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS record_history_lookup
  ON record_history (collection, id, tenant_id, namespace_id);
CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox (event_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS embeddings (claim_id TEXT PRIMARY KEY, vector TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS claim_fts (
  claim_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  namespace_id TEXT,
  body TEXT NOT NULL,
  search_vector tsvector
);
CREATE INDEX IF NOT EXISTS claim_fts_search ON claim_fts USING GIN (search_vector);
`;

const UPSERT_RECORD = `
INSERT INTO records (collection, id, tenant_id, namespace_id, payload)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (collection, id) DO UPDATE SET
  tenant_id = EXCLUDED.tenant_id,
  namespace_id = EXCLUDED.namespace_id,
  payload = EXCLUDED.payload
`;

type ScopedRecord = {
  id: string;
  tenantId: TenantId;
  namespaceId: NamespaceId;
};

type PayloadRow = { payload: string };
type ClaimIdRow = { claim_id: string };
type EmbeddingSqlRow = { claim_id: string; vector: string };

function parsePayload<T>(payload: string): T {
  return JSON.parse(payload) as T;
}

function latestClaimKnownAt(
  versions: readonly Claim[],
  knownAt: string | undefined,
): Claim | undefined {
  if (knownAt === undefined) {
    return versions.at(-1);
  }
  return versions
    .filter((claim) => claim.bitemporal.recordedAt <= knownAt)
    .sort((left, right) => left.bitemporal.recordedAt.localeCompare(right.bitemporal.recordedAt))
    .at(-1);
}

class PostgresCanonicalStore implements CanonicalStore {
  private readonly ready: Promise<void>;

  constructor(
    private readonly sql: SqlClient,
    ready?: Promise<void>,
  ) {
    this.ready = ready ?? this.sql.exec(SCHEMA);
  }

  async withTransaction<T>(fn: (tx: CanonicalStore) => Promise<T>): Promise<T> {
    await this.ready;
    return this.sql.withTransaction(async (txSql) => {
      const txStore = new PostgresCanonicalStore(txSql, Promise.resolve());
      return fn(txStore);
    });
  }

  async putEntity(entity: Entity): Promise<void> {
    await this.putRecord(COLLECTIONS.entities, entity);
  }

  async getEntity(id: EntityId): Promise<Entity | undefined> {
    return this.getRecord<Entity>(COLLECTIONS.entities, id);
  }

  async listEntities(filter: {
    tenantId: TenantId;
    namespaceId?: NamespaceId;
  }): Promise<readonly Entity[]> {
    return this.listRecords<Entity>(COLLECTIONS.entities, filter);
  }

  async putEvidence(item: Evidence): Promise<void> {
    await this.putRecord(COLLECTIONS.evidence, item);
  }

  async getEvidence(id: EvidenceId): Promise<Evidence | undefined> {
    return this.getRecord<Evidence>(COLLECTIONS.evidence, id);
  }

  async assertClaim(claim: Claim): Promise<void> {
    await this.putRecord(COLLECTIONS.claims, claim);
    await this.upsertFts(claim);
  }

  async getClaim(id: ClaimId): Promise<Claim | undefined> {
    return this.getRecord<Claim>(COLLECTIONS.claims, id);
  }

  async listClaims(filter: ClaimReadFilter): Promise<readonly Claim[]> {
    const temporal = normalizeTemporalPerspective(filter.temporal, filter.asOf);
    const current = await this.listRecords<Claim>(COLLECTIONS.claims, filter);
    if (temporal.knownAt === undefined) {
      return current.filter((claim) => claimVisibleAt(claim, temporal));
    }

    const history = await this.listHistoricalRecords<Claim>(COLLECTIONS.claims, filter);
    const versionsById = new Map<string, Claim[]>();
    for (const claim of [...history, ...current]) {
      const versions = versionsById.get(claim.id) ?? [];
      versions.push(claim);
      versionsById.set(claim.id, versions);
    }
    const claims: Claim[] = [];
    for (const versions of versionsById.values()) {
      const claim = latestClaimKnownAt(versions, temporal.knownAt);
      if (claim !== undefined && claimVisibleAt(claim, temporal)) {
        claims.push(claim);
      }
    }
    return claims;
  }

  async retractClaim(claim: Claim): Promise<void> {
    await this.putRecord(COLLECTIONS.claims, claim);
    await this.upsertFts(claim);
  }

  async putDecision(decision: Decision): Promise<void> {
    await this.putRecord(COLLECTIONS.decisions, decision);
  }

  async getDecision(id: DecisionId): Promise<Decision | undefined> {
    return this.getRecord<Decision>(COLLECTIONS.decisions, id);
  }

  async listDecisions(filter: {
    tenantId: TenantId;
    namespaceId?: NamespaceId;
  }): Promise<readonly Decision[]> {
    return this.listRecords<Decision>(COLLECTIONS.decisions, filter);
  }

  async putContextSnapshot(snapshot: ContextSnapshot): Promise<void> {
    await this.putRecord(COLLECTIONS.snapshots, snapshot);
  }

  async getContextSnapshot(id: ContextId): Promise<ContextSnapshot | undefined> {
    return this.getRecord<ContextSnapshot>(COLLECTIONS.snapshots, id);
  }

  async putRetrievalReceipt(receipt: RetrievalReceipt): Promise<void> {
    await this.putRecord(COLLECTIONS.retrievalReceipts, receipt);
  }

  async getRetrievalReceipt(id: RetrievalReceiptId): Promise<RetrievalReceipt | undefined> {
    return this.getRecord<RetrievalReceipt>(COLLECTIONS.retrievalReceipts, id);
  }

  async putMemory(record: MemoryRecord): Promise<void> {
    await this.putRecord(COLLECTIONS.memory, record);
  }

  async listMemory(filter: {
    tenantId: TenantId;
    namespaceId?: NamespaceId;
  }): Promise<readonly MemoryRecord[]> {
    return this.listRecords<MemoryRecord>(COLLECTIONS.memory, filter);
  }

  async putPolicy(policy: PolicyRecord): Promise<void> {
    await this.putRecord(COLLECTIONS.policies, policy);
  }

  async getPolicy(id: PolicyId): Promise<PolicyRecord | undefined> {
    return this.getRecord<PolicyRecord>(COLLECTIONS.policies, id);
  }

  async listPolicies(filter: { tenantId: TenantId }): Promise<readonly PolicyRecord[]> {
    return this.listRecords<PolicyRecord>(COLLECTIONS.policies, filter);
  }

  async putConflict(conflict: Conflict): Promise<void> {
    await this.putRecord(COLLECTIONS.conflicts, conflict);
  }

  async putResolution(resolution: ConflictResolution): Promise<void> {
    await this.putRecord(COLLECTIONS.resolutions, resolution);
  }

  async listConflicts(filter: { tenantId: TenantId }): Promise<readonly Conflict[]> {
    return this.listRecords<Conflict>(COLLECTIONS.conflicts, filter);
  }

  async listResolutions(filter: { tenantId: TenantId }): Promise<readonly ConflictResolution[]> {
    return this.listRecords<ConflictResolution>(COLLECTIONS.resolutions, filter);
  }

  async appendEvent(event: DomainEvent): Promise<void> {
    await this.ready;
    await this.sql.query('INSERT INTO events (event_id, payload) VALUES ($1, $2)', [
      event.eventId,
      JSON.stringify(event),
    ]);
  }

  async listEvents(): Promise<readonly DomainEvent[]> {
    await this.ready;
    const rows = await this.sql.query<PayloadRow>('SELECT payload FROM events');
    return rows.map((row) => parsePayload<DomainEvent>(row.payload));
  }

  async appendOutbox(event: DomainEvent): Promise<void> {
    await this.ready;
    await this.sql.query('INSERT INTO outbox (event_id, payload) VALUES ($1, $2)', [
      event.eventId,
      JSON.stringify(event),
    ]);
  }

  async listOutbox(): Promise<readonly DomainEvent[]> {
    await this.ready;
    const rows = await this.sql.query<PayloadRow>('SELECT payload FROM outbox');
    return rows.map((row) => parsePayload<DomainEvent>(row.payload));
  }

  async ackOutbox(eventId: EventId): Promise<void> {
    await this.ready;
    await this.sql.query('DELETE FROM outbox WHERE event_id = $1', [eventId]);
  }

  async putEmbedding(input: { claimId: ClaimId; vector: readonly number[] }): Promise<void> {
    await this.ready;
    await this.sql.query(
      `INSERT INTO embeddings (claim_id, vector) VALUES ($1, $2)
       ON CONFLICT (claim_id) DO UPDATE SET vector = EXCLUDED.vector`,
      [input.claimId, JSON.stringify(input.vector)],
    );
  }

  async listEmbeddings(): Promise<readonly { claimId: ClaimId; vector: readonly number[] }[]> {
    await this.ready;
    const rows = await this.sql.query<EmbeddingSqlRow>('SELECT claim_id, vector FROM embeddings');
    return rows.map((row) => ({
      claimId: row.claim_id as ClaimId,
      vector: parsePayload<readonly number[]>(row.vector),
    }));
  }

  async clearEmbeddings(): Promise<void> {
    await this.ready;
    await this.sql.exec('DELETE FROM embeddings');
  }

  async searchLexical(
    input: ClaimReadFilter & {
      query: string;
      limit: number;
    },
  ): Promise<readonly Claim[]> {
    const temporal = normalizeTemporalPerspective(input.temporal, input.asOf);
    const ftsQuery = postgresFtsQuery(input.query);
    if (ftsQuery.length === 0) {
      const claims = await this.listClaims(input);
      return claims.slice(0, input.limit);
    }
    await this.ready;
    const rows = await this.sql.query<ClaimIdRow>(
      `SELECT claim_id FROM claim_fts
       WHERE search_vector @@ to_tsquery('simple', $1) AND tenant_id = $2
       LIMIT $3`,
      [ftsQuery, input.tenantId, input.limit],
    );
    const claims: Claim[] = [];
    for (const row of rows) {
      const claim = await this.claimKnownAt(row.claim_id as ClaimId, temporal.knownAt);
      if (
        claim !== undefined &&
        (input.namespaceId === undefined || claim.namespaceId === input.namespaceId) &&
        claimVisibleAt(claim, temporal)
      ) {
        claims.push(claim);
      }
    }
    return claims;
  }

  async rebuildLexicalProjection(): Promise<void> {
    await this.ready;
    await this.sql.exec('DELETE FROM claim_fts');
    const rows = await this.sql.query<PayloadRow>(
      'SELECT payload FROM records WHERE collection = $1',
      [COLLECTIONS.claims],
    );
    for (const row of rows) {
      await this.upsertFts(parsePayload<Claim>(row.payload));
    }
  }

  private async claimKnownAt(id: ClaimId, knownAt: string | undefined): Promise<Claim | undefined> {
    const current = await this.getRecord<Claim>(COLLECTIONS.claims, id);
    if (current === undefined) {
      return undefined;
    }
    if (knownAt === undefined) {
      return current;
    }
    await this.ready;
    const rows = await this.sql.query<PayloadRow>(
      'SELECT payload FROM record_history WHERE collection = $1 AND id = $2',
      [COLLECTIONS.claims, id],
    );
    const history = rows.map((row) => parsePayload<Claim>(row.payload));
    return latestClaimKnownAt([...history, current], knownAt);
  }

  private async upsertFts(claim: Claim): Promise<void> {
    await this.ready;
    await this.sql.query('DELETE FROM claim_fts WHERE claim_id = $1', [claim.id]);
    await this.sql.query(
      `INSERT INTO claim_fts (claim_id, tenant_id, namespace_id, body, search_vector)
       VALUES ($1, $2, $3, $4, to_tsvector('simple', $4))`,
      [claim.id, claim.tenantId, claim.namespaceId, claimText(claim)],
    );
  }

  private async putRecord(collection: string, record: ScopedRecord): Promise<void> {
    await this.ready;
    const currentRows = await this.sql.query<{
      tenant_id: string;
      namespace_id: string | null;
      payload: string;
    }>('SELECT tenant_id, namespace_id, payload FROM records WHERE collection = $1 AND id = $2', [
      collection,
      record.id,
    ]);
    const current = currentRows[0];
    if (current !== undefined) {
      await this.sql.query(
        'INSERT INTO record_history (collection, id, tenant_id, namespace_id, payload) VALUES ($1, $2, $3, $4, $5)',
        [collection, record.id, current.tenant_id, current.namespace_id, current.payload],
      );
    }
    await this.sql.query(UPSERT_RECORD, [
      collection,
      record.id,
      record.tenantId,
      record.namespaceId,
      JSON.stringify(record),
    ]);
  }

  private async getRecord<T>(collection: string, id: string): Promise<T | undefined> {
    await this.ready;
    const rows = await this.sql.query<PayloadRow>(
      'SELECT payload FROM records WHERE collection = $1 AND id = $2',
      [collection, id],
    );
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    return parsePayload<T>(row.payload);
  }

  private async listRecords<T extends ScopedRecord>(
    collection: string,
    filter: { tenantId: TenantId; namespaceId?: NamespaceId },
  ): Promise<T[]> {
    await this.ready;
    const sql =
      filter.namespaceId === undefined
        ? 'SELECT payload FROM records WHERE collection = $1 AND tenant_id = $2'
        : 'SELECT payload FROM records WHERE collection = $1 AND tenant_id = $2 AND namespace_id = $3';
    const params =
      filter.namespaceId === undefined
        ? [collection, filter.tenantId]
        : [collection, filter.tenantId, filter.namespaceId];
    const rows = await this.sql.query<PayloadRow>(sql, params);
    return rows.map((row) => parsePayload<T>(row.payload));
  }

  private async listHistoricalRecords<T extends ScopedRecord>(
    collection: string,
    filter: { tenantId: TenantId; namespaceId?: NamespaceId },
  ): Promise<T[]> {
    await this.ready;
    const sql =
      filter.namespaceId === undefined
        ? 'SELECT payload FROM record_history WHERE collection = $1 AND tenant_id = $2'
        : 'SELECT payload FROM record_history WHERE collection = $1 AND tenant_id = $2 AND namespace_id = $3';
    const params =
      filter.namespaceId === undefined
        ? [collection, filter.tenantId]
        : [collection, filter.tenantId, filter.namespaceId];
    const rows = await this.sql.query<PayloadRow>(sql, params);
    return rows.map((row) => parsePayload<T>(row.payload));
  }
}

export function createPostgresCanonicalStore(client: SqlClient): CanonicalStore {
  return new PostgresCanonicalStore(client);
}

export async function createPgliteCanonicalStore(): Promise<CanonicalStore> {
  const client = await createPgliteClient();
  return createPostgresCanonicalStore(client);
}

export function createPgCanonicalStore(connectionString: string): CanonicalStore {
  return createPostgresCanonicalStore(createPgPoolClient(connectionString));
}
