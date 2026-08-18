import { DatabaseSync } from 'node:sqlite';

import {
  claimText,
  claimVisibleAt,
  ftsMatchQuery,
  lexicalTokens,
  normalizeTemporalPerspective,
} from '@kotowari/plugin-sdk';

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
  history_id INTEGER PRIMARY KEY AUTOINCREMENT,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  namespace_id TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS record_history_lookup
  ON record_history (collection, id, tenant_id, namespace_id);
CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  event_id TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS embeddings (
  claim_id TEXT PRIMARY KEY,
  vector TEXT NOT NULL
);
`;

const FTS5_SCHEMA = `CREATE VIRTUAL TABLE IF NOT EXISTS claim_fts USING fts5(
  claim_id UNINDEXED,
  tenant_id UNINDEXED,
  namespace_id UNINDEXED,
  body
);`;

const TABLE_FTS_SCHEMA = `CREATE TABLE IF NOT EXISTS claim_fts (
  claim_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  namespace_id TEXT,
  body TEXT NOT NULL
);`;

type ScopedRecord = {
  id: string;
  tenantId: TenantId;
  namespaceId: NamespaceId;
};

type PreparedStatement = ReturnType<DatabaseSync['prepare']>;
type PayloadRow = { payload: string };
type VersionedPayloadRow = { id: string; payload: string };

function openLexicalProjection(db: DatabaseSync): 'fts5' | 'table' {
  try {
    db.exec(FTS5_SCHEMA);
    return 'fts5';
  } catch {
    db.exec(TABLE_FTS_SCHEMA);
    return 'table';
  }
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

class SqliteCanonicalStore implements CanonicalStore {
  private transactionDepth = 0;
  private readonly statements = new Map<string, PreparedStatement>();
  private readonly lexicalMode: 'fts5' | 'table';

  constructor(private readonly db: DatabaseSync) {
    this.db.exec(SCHEMA);
    this.lexicalMode = openLexicalProjection(db);
  }

  async withTransaction<T>(fn: (tx: CanonicalStore) => Promise<T>): Promise<T> {
    if (this.transactionDepth > 0) {
      return fn(this);
    }

    this.transactionDepth++;
    try {
      this.db.exec('BEGIN');
      const result = await fn(this);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    } finally {
      this.transactionDepth--;
    }
  }

  async putEntity(entity: Entity): Promise<void> {
    this.putRecord(COLLECTIONS.entities, entity);
  }

  async getEntity(id: EntityId): Promise<Entity | undefined> {
    return this.getRecord<Entity>(COLLECTIONS.entities, id);
  }

  async putEvidence(item: Evidence): Promise<void> {
    this.putRecord(COLLECTIONS.evidence, item);
  }

  async getEvidence(id: EvidenceId): Promise<Evidence | undefined> {
    return this.getRecord<Evidence>(COLLECTIONS.evidence, id);
  }

  async assertClaim(claim: Claim): Promise<void> {
    this.putRecord(COLLECTIONS.claims, claim);
    this.upsertFts(claim);
  }

  async getClaim(id: ClaimId): Promise<Claim | undefined> {
    return this.getRecord<Claim>(COLLECTIONS.claims, id);
  }

  async listClaims(filter: ClaimReadFilter): Promise<readonly Claim[]> {
    const temporal = normalizeTemporalPerspective(filter.temporal, filter.asOf);
    const current = this.listRecords<Claim>(COLLECTIONS.claims, filter);
    if (temporal.knownAt === undefined) {
      return current.filter((claim) => claimVisibleAt(claim, temporal));
    }

    const history = this.listHistoricalRecords<Claim>(COLLECTIONS.claims, filter);
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
    this.putRecord(COLLECTIONS.claims, claim);
    this.upsertFts(claim);
  }

  async putDecision(decision: Decision): Promise<void> {
    this.putRecord(COLLECTIONS.decisions, decision);
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
    this.putRecord(COLLECTIONS.snapshots, snapshot);
  }

  async getContextSnapshot(id: ContextId): Promise<ContextSnapshot | undefined> {
    return this.getRecord<ContextSnapshot>(COLLECTIONS.snapshots, id);
  }

  async putRetrievalReceipt(receipt: RetrievalReceipt): Promise<void> {
    this.putRecord(COLLECTIONS.retrievalReceipts, receipt);
  }

  async getRetrievalReceipt(id: RetrievalReceiptId): Promise<RetrievalReceipt | undefined> {
    return this.getRecord<RetrievalReceipt>(COLLECTIONS.retrievalReceipts, id);
  }

  async putMemory(record: MemoryRecord): Promise<void> {
    this.putRecord(COLLECTIONS.memory, record);
  }

  async listMemory(filter: {
    tenantId: TenantId;
    namespaceId?: NamespaceId;
  }): Promise<readonly MemoryRecord[]> {
    return this.listRecords<MemoryRecord>(COLLECTIONS.memory, filter);
  }

  async putPolicy(policy: PolicyRecord): Promise<void> {
    this.putRecord(COLLECTIONS.policies, policy);
  }

  async getPolicy(id: PolicyId): Promise<PolicyRecord | undefined> {
    return this.getRecord<PolicyRecord>(COLLECTIONS.policies, id);
  }

  async listPolicies(filter: { tenantId: TenantId }): Promise<readonly PolicyRecord[]> {
    return this.listRecords<PolicyRecord>(COLLECTIONS.policies, filter);
  }

  async putConflict(conflict: Conflict): Promise<void> {
    this.putRecord(COLLECTIONS.conflicts, conflict);
  }

  async putResolution(resolution: ConflictResolution): Promise<void> {
    this.putRecord(COLLECTIONS.resolutions, resolution);
  }

  async listConflicts(filter: { tenantId: TenantId }): Promise<readonly Conflict[]> {
    return this.listRecords<Conflict>(COLLECTIONS.conflicts, filter);
  }

  async listResolutions(filter: { tenantId: TenantId }): Promise<readonly ConflictResolution[]> {
    return this.listRecords<ConflictResolution>(COLLECTIONS.resolutions, filter);
  }

  async appendEvent(event: DomainEvent): Promise<void> {
    this.stmt('INSERT INTO events (event_id, payload) VALUES (?, ?)').run(
      event.eventId,
      JSON.stringify(event),
    );
  }

  async listEvents(): Promise<readonly DomainEvent[]> {
    const rows = this.stmt('SELECT payload FROM events').all() as PayloadRow[];
    return rows.map((row) => JSON.parse(row.payload) as DomainEvent);
  }

  async appendOutbox(event: DomainEvent): Promise<void> {
    this.stmt('INSERT INTO outbox (event_id, payload) VALUES (?, ?)').run(
      event.eventId,
      JSON.stringify(event),
    );
  }

  async listOutbox(): Promise<readonly DomainEvent[]> {
    const rows = this.stmt('SELECT payload FROM outbox').all() as PayloadRow[];
    return rows.map((row) => JSON.parse(row.payload) as DomainEvent);
  }

  async ackOutbox(eventId: EventId): Promise<void> {
    this.stmt('DELETE FROM outbox WHERE event_id = ?').run(eventId);
  }

  async putEmbedding(input: { claimId: ClaimId; vector: readonly number[] }): Promise<void> {
    this.stmt('INSERT OR REPLACE INTO embeddings (claim_id, vector) VALUES (?, ?)').run(
      input.claimId,
      JSON.stringify(input.vector),
    );
  }

  async listEmbeddings(): Promise<readonly { claimId: ClaimId; vector: readonly number[] }[]> {
    const rows = this.stmt('SELECT claim_id, vector FROM embeddings').all() as {
      claim_id: string;
      vector: string;
    }[];
    return rows.map((row) => ({
      claimId: row.claim_id as ClaimId,
      vector: JSON.parse(row.vector) as readonly number[],
    }));
  }

  async clearEmbeddings(): Promise<void> {
    this.db.exec('DELETE FROM embeddings');
  }

  async searchLexical(
    input: ClaimReadFilter & {
      query: string;
      limit: number;
    },
  ): Promise<readonly Claim[]> {
    const temporal = normalizeTemporalPerspective(input.temporal, input.asOf);
    const match = ftsMatchQuery(input.query);
    if (match.length === 0) {
      const claims = await this.listClaims(input);
      return claims.slice(0, input.limit);
    }
    const rows =
      this.lexicalMode === 'fts5'
        ? (this.stmt(
            'SELECT claim_id FROM claim_fts WHERE claim_fts MATCH ? AND tenant_id = ? LIMIT ?',
          ).all(match, input.tenantId, input.limit) as { claim_id: string }[])
        : this.searchLexicalTable(input);
    const claims: Claim[] = [];
    for (const row of rows) {
      const claim = this.claimKnownAt(row.claim_id as ClaimId, temporal.knownAt);
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
    this.db.exec('DELETE FROM claim_fts');
    const rows = this.stmt(
      "SELECT payload FROM records WHERE collection = 'claims'",
    ).all() as PayloadRow[];
    for (const row of rows) {
      this.upsertFts(JSON.parse(row.payload) as Claim);
    }
  }

  private searchLexicalTable(input: {
    tenantId: TenantId;
    query: string;
    limit: number;
  }): { claim_id: string }[] {
    const tokens = lexicalTokens(input.query);
    if (tokens.length === 0) {
      return [];
    }
    const likes = tokens.map(() => 'body LIKE ?').join(' OR ');
    const params = [input.tenantId, ...tokens.map((token) => `%${token}%`), input.limit];
    return this.stmt(
      `SELECT claim_id FROM claim_fts WHERE tenant_id = ? AND (${likes}) LIMIT ?`,
    ).all(...params) as { claim_id: string }[];
  }

  private claimKnownAt(id: ClaimId, knownAt: string | undefined): Claim | undefined {
    const current = this.getRecord<Claim>(COLLECTIONS.claims, id);
    if (current === undefined) {
      return undefined;
    }
    if (knownAt === undefined) {
      return current;
    }
    const rows = this.stmt(
      'SELECT payload FROM record_history WHERE collection = ? AND id = ?',
    ).all(COLLECTIONS.claims, id) as PayloadRow[];
    const history = rows.map((row) => JSON.parse(row.payload) as Claim);
    return latestClaimKnownAt([...history, current], knownAt);
  }

  private upsertFts(claim: Claim): void {
    this.stmt('DELETE FROM claim_fts WHERE claim_id = ?').run(claim.id);
    this.stmt(
      'INSERT INTO claim_fts (claim_id, tenant_id, namespace_id, body) VALUES (?, ?, ?, ?)',
    ).run(claim.id, claim.tenantId, claim.namespaceId, claimText(claim));
  }

  private stmt(sql: string): PreparedStatement {
    const cached = this.statements.get(sql);
    if (cached !== undefined) {
      return cached;
    }
    const prepared = this.db.prepare(sql);
    this.statements.set(sql, prepared);
    return prepared;
  }

  private putRecord(collection: string, record: ScopedRecord): void {
    const current = this.stmt(
      'SELECT tenant_id, namespace_id, payload FROM records WHERE collection = ? AND id = ?',
    ).get(collection, record.id) as
      { tenant_id: string; namespace_id: string | null; payload: string } | undefined;
    if (current !== undefined) {
      this.stmt(
        'INSERT INTO record_history (collection, id, tenant_id, namespace_id, payload) VALUES (?, ?, ?, ?, ?)',
      ).run(collection, record.id, current.tenant_id, current.namespace_id, current.payload);
    }
    this.stmt(
      'INSERT OR REPLACE INTO records (collection, id, tenant_id, namespace_id, payload) VALUES (?, ?, ?, ?, ?)',
    ).run(collection, record.id, record.tenantId, record.namespaceId, JSON.stringify(record));
  }

  private getRecord<T>(collection: string, id: string): T | undefined {
    const row = this.stmt('SELECT payload FROM records WHERE collection = ? AND id = ?').get(
      collection,
      id,
    ) as PayloadRow | undefined;
    if (row === undefined) {
      return undefined;
    }
    return JSON.parse(row.payload) as T;
  }

  private listRecords<T extends ScopedRecord>(
    collection: string,
    filter: { tenantId: TenantId; namespaceId?: NamespaceId },
  ): T[] {
    const sql =
      filter.namespaceId === undefined
        ? 'SELECT payload FROM records WHERE collection = ? AND tenant_id = ?'
        : 'SELECT payload FROM records WHERE collection = ? AND tenant_id = ? AND namespace_id = ?';
    const params =
      filter.namespaceId === undefined
        ? [collection, filter.tenantId]
        : [collection, filter.tenantId, filter.namespaceId];
    const rows = this.stmt(sql).all(...params) as PayloadRow[];
    return rows.map((row) => JSON.parse(row.payload) as T);
  }

  private listHistoricalRecords<T extends ScopedRecord>(
    collection: string,
    filter: { tenantId: TenantId; namespaceId?: NamespaceId },
  ): T[] {
    const sql =
      filter.namespaceId === undefined
        ? 'SELECT id, payload FROM record_history WHERE collection = ? AND tenant_id = ?'
        : 'SELECT id, payload FROM record_history WHERE collection = ? AND tenant_id = ? AND namespace_id = ?';
    const params =
      filter.namespaceId === undefined
        ? [collection, filter.tenantId]
        : [collection, filter.tenantId, filter.namespaceId];
    const rows = this.stmt(sql).all(...params) as VersionedPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload) as T);
  }
}

export function createSqliteCanonicalStore(path: string): CanonicalStore {
  const db = new DatabaseSync(path);
  return new SqliteCanonicalStore(db);
}
