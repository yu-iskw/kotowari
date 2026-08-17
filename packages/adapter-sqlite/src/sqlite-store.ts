import { DatabaseSync } from 'node:sqlite';

import type {
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
import type { CanonicalStore } from '@kotowari/plugin-sdk';

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

function claimAsOf(claim: Claim, asOf: string | undefined): boolean {
  if (asOf === undefined) {
    return true;
  }
  const { validFrom, validTo } = claim.bitemporal;
  return validFrom <= asOf && (validTo === undefined || asOf < validTo);
}

class SqliteCanonicalStore implements CanonicalStore {
  private transactionDepth = 0;

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

  private putRecord(collection: string, record: ScopedRecord): void {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO records (collection, id, tenant_id, namespace_id, payload) VALUES (?, ?, ?, ?, ?)',
    );
    stmt.run(collection, record.id, record.tenantId, record.namespaceId, JSON.stringify(record));
  }

  private getRecord<T>(collection: string, id: string): T | undefined {
    const stmt = this.db.prepare('SELECT payload FROM records WHERE collection = ? AND id = ?');
    const row = stmt.get(collection, id) as { payload: string } | undefined;
    if (row === undefined) {
      return undefined;
    }
    return JSON.parse(row.payload) as T;
  }

  private listRecords<T extends ScopedRecord>(
    collection: string,
    filter: { tenantId: TenantId; namespaceId?: NamespaceId },
  ): T[] {
    let sql = 'SELECT payload FROM records WHERE collection = ? AND tenant_id = ?';
    const params: (string | TenantId | NamespaceId)[] = [collection, filter.tenantId];
    if (filter.namespaceId !== undefined) {
      sql += ' AND namespace_id = ?';
      params.push(filter.namespaceId);
    }
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as T);
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
      claimAsOf(claim, filter.asOf),
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
    const stmt = this.db.prepare('INSERT INTO events (event_id, payload) VALUES (?, ?)');
    stmt.run(event.eventId, JSON.stringify(event));
  }

  async listEvents(): Promise<readonly DomainEvent[]> {
    const stmt = this.db.prepare('SELECT payload FROM events');
    const rows = stmt.all() as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as DomainEvent);
  }

  async appendOutbox(event: DomainEvent): Promise<void> {
    const stmt = this.db.prepare('INSERT INTO outbox (event_id, payload) VALUES (?, ?)');
    stmt.run(event.eventId, JSON.stringify(event));
  }

  async listOutbox(): Promise<readonly DomainEvent[]> {
    const stmt = this.db.prepare('SELECT payload FROM outbox');
    const rows = stmt.all() as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as DomainEvent);
  }

  async ackOutbox(eventId: EventId): Promise<void> {
    const stmt = this.db.prepare('DELETE FROM outbox WHERE event_id = ?');
    stmt.run(eventId);
  }

  async putEmbedding(input: { claimId: ClaimId; vector: readonly number[] }): Promise<void> {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO embeddings (claim_id, vector) VALUES (?, ?)');
    stmt.run(input.claimId, JSON.stringify(input.vector));
  }

  async listEmbeddings(): Promise<readonly { claimId: ClaimId; vector: readonly number[] }[]> {
    const stmt = this.db.prepare('SELECT claim_id, vector FROM embeddings');
    const rows = stmt.all() as { claim_id: string; vector: string }[];
    return rows.map((row) => ({
      claimId: row.claim_id as ClaimId,
      vector: JSON.parse(row.vector) as readonly number[],
    }));
  }

  async clearEmbeddings(): Promise<void> {
    this.db.exec('DELETE FROM embeddings');
  }
}

export function createSqliteCanonicalStore(path: string): CanonicalStore {
  const db = new DatabaseSync(path);
  return new SqliteCanonicalStore(db);
}
