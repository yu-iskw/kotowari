import { DatabaseSync } from 'node:sqlite';

import { claimValidAt } from '@kotowari/plugin-sdk';

import type {
  CanonicalStore,
  Claim,
  ClaimId,
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
  TenantId,
} from '@kotowari/plugin-sdk';

const COLLECTIONS = {
  entities: 'entities',
  evidence: 'evidence',
  claims: 'claims',
  decisions: 'decisions',
  snapshots: 'snapshots',
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

type ScopedRecord = {
  id: string;
  tenantId: TenantId;
  namespaceId: NamespaceId;
};

type PreparedStatement = ReturnType<DatabaseSync['prepare']>;

class SqliteCanonicalStore implements CanonicalStore {
  private transactionDepth = 0;
  private readonly statements = new Map<string, PreparedStatement>();

  constructor(private readonly db: DatabaseSync) {
    this.db.exec(SCHEMA);
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
  }

  async getClaim(id: ClaimId): Promise<Claim | undefined> {
    return this.getRecord<Claim>(COLLECTIONS.claims, id);
  }

  async listClaims(filter: {
    tenantId: TenantId;
    namespaceId?: NamespaceId;
    asOf?: string;
  }): Promise<readonly Claim[]> {
    return this.listRecords<Claim>(COLLECTIONS.claims, filter).filter((claim) =>
      claimValidAt(claim, filter.asOf),
    );
  }

  async retractClaim(claim: Claim): Promise<void> {
    this.putRecord(COLLECTIONS.claims, claim);
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
    const rows = this.stmt('SELECT payload FROM events').all() as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as DomainEvent);
  }

  async appendOutbox(event: DomainEvent): Promise<void> {
    this.stmt('INSERT INTO outbox (event_id, payload) VALUES (?, ?)').run(
      event.eventId,
      JSON.stringify(event),
    );
  }

  async listOutbox(): Promise<readonly DomainEvent[]> {
    const rows = this.stmt('SELECT payload FROM outbox').all() as { payload: string }[];
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
    this.stmt(
      'INSERT OR REPLACE INTO records (collection, id, tenant_id, namespace_id, payload) VALUES (?, ?, ?, ?, ?)',
    ).run(collection, record.id, record.tenantId, record.namespaceId, JSON.stringify(record));
  }

  private getRecord<T>(collection: string, id: string): T | undefined {
    const row = this.stmt('SELECT payload FROM records WHERE collection = ? AND id = ?').get(
      collection,
      id,
    ) as { payload: string } | undefined;
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
    const rows = this.stmt(sql).all(...params) as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as T);
  }
}

export function createSqliteCanonicalStore(path: string): CanonicalStore {
  const db = new DatabaseSync(path);
  return new SqliteCanonicalStore(db);
}
