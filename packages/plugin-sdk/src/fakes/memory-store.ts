import { claimVisibleAt, normalizeTemporalPerspective } from '../contracts.js';
import { rankClaimsLexically } from '../lexical-search.js';

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
  RetrievalReceipt,
  RetrievalReceiptId,
  TenantId,
} from '../contracts.js';
import type { BlobStore, CanonicalStore, ClaimReadFilter } from '../ports.js';

type EmbeddingRow = { claimId: ClaimId; vector: readonly number[] };

function matchesTenant<T extends { tenantId: TenantId }>(record: T, tenantId: TenantId): boolean {
  return record.tenantId === tenantId;
}

function matchesNamespace<T extends { namespaceId: NamespaceId }>(
  record: T,
  namespaceId: NamespaceId | undefined,
): boolean {
  return namespaceId === undefined || record.namespaceId === namespaceId;
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

class MemoryCanonicalStore implements CanonicalStore {
  readonly entities = new Map<EntityId, Entity>();
  readonly evidence = new Map<EvidenceId, Evidence>();
  readonly claims = new Map<ClaimId, Claim>();
  readonly claimHistory = new Map<ClaimId, Claim[]>();
  readonly decisions = new Map<DecisionId, Decision>();
  readonly snapshots = new Map<ContextId, ContextSnapshot>();
  readonly retrievalReceipts = new Map<RetrievalReceiptId, RetrievalReceipt>();
  readonly memory = new Map<string, MemoryRecord>();
  readonly policies = new Map<PolicyId, PolicyRecord>();
  readonly conflicts = new Map<string, Conflict>();
  readonly resolutions = new Map<string, ConflictResolution>();
  readonly events: DomainEvent[] = [];
  readonly outbox: DomainEvent[] = [];
  readonly embeddings = new Map<ClaimId, readonly number[]>();

  async withTransaction<T>(fn: (tx: CanonicalStore) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async putEntity(entity: Entity): Promise<void> {
    this.entities.set(entity.id, entity);
  }

  async getEntity(id: EntityId): Promise<Entity | undefined> {
    return this.entities.get(id);
  }

  async listEntities(filter: {
    tenantId: TenantId;
    namespaceId?: NamespaceId;
  }): Promise<readonly Entity[]> {
    return [...this.entities.values()].filter(
      (entity) =>
        matchesTenant(entity, filter.tenantId) && matchesNamespace(entity, filter.namespaceId),
    );
  }

  async putEvidence(item: Evidence): Promise<void> {
    this.evidence.set(item.id, item);
  }

  async getEvidence(id: EvidenceId): Promise<Evidence | undefined> {
    return this.evidence.get(id);
  }

  async assertClaim(claim: Claim): Promise<void> {
    this.rememberCurrentClaim(claim.id);
    this.claims.set(claim.id, claim);
  }

  async getClaim(id: ClaimId): Promise<Claim | undefined> {
    return this.claims.get(id);
  }

  async listClaims(filter: ClaimReadFilter): Promise<readonly Claim[]> {
    const temporal = normalizeTemporalPerspective(filter.temporal, filter.asOf);
    const claims: Claim[] = [];
    for (const current of this.claims.values()) {
      if (
        !matchesTenant(current, filter.tenantId) ||
        !matchesNamespace(current, filter.namespaceId)
      ) {
        continue;
      }
      const versions = [...(this.claimHistory.get(current.id) ?? []), current];
      const visible = latestClaimKnownAt(versions, temporal.knownAt);
      if (visible !== undefined && claimVisibleAt(visible, temporal)) {
        claims.push(visible);
      }
    }
    return claims;
  }

  async retractClaim(claim: Claim): Promise<void> {
    this.rememberCurrentClaim(claim.id);
    this.claims.set(claim.id, claim);
  }

  async putDecision(decision: Decision): Promise<void> {
    this.decisions.set(decision.id, decision);
  }

  async getDecision(id: DecisionId): Promise<Decision | undefined> {
    return this.decisions.get(id);
  }

  async listDecisions(filter: {
    tenantId: TenantId;
    namespaceId?: NamespaceId;
  }): Promise<readonly Decision[]> {
    return [...this.decisions.values()].filter(
      (decision) =>
        matchesTenant(decision, filter.tenantId) && matchesNamespace(decision, filter.namespaceId),
    );
  }

  async putContextSnapshot(snapshot: ContextSnapshot): Promise<void> {
    this.snapshots.set(snapshot.id, snapshot);
  }

  async getContextSnapshot(id: ContextId): Promise<ContextSnapshot | undefined> {
    return this.snapshots.get(id);
  }

  async putRetrievalReceipt(receipt: RetrievalReceipt): Promise<void> {
    this.retrievalReceipts.set(receipt.id, receipt);
  }

  async getRetrievalReceipt(id: RetrievalReceiptId): Promise<RetrievalReceipt | undefined> {
    return this.retrievalReceipts.get(id);
  }

  async putMemory(record: MemoryRecord): Promise<void> {
    this.memory.set(record.id, record);
  }

  async listMemory(filter: {
    tenantId: TenantId;
    namespaceId?: NamespaceId;
  }): Promise<readonly MemoryRecord[]> {
    return [...this.memory.values()].filter(
      (record) =>
        matchesTenant(record, filter.tenantId) && matchesNamespace(record, filter.namespaceId),
    );
  }

  async putPolicy(policy: PolicyRecord): Promise<void> {
    this.policies.set(policy.id, policy);
  }

  async getPolicy(id: PolicyId): Promise<PolicyRecord | undefined> {
    return this.policies.get(id);
  }

  async listPolicies(filter: { tenantId: TenantId }): Promise<readonly PolicyRecord[]> {
    return [...this.policies.values()].filter((policy) => matchesTenant(policy, filter.tenantId));
  }

  async putConflict(conflict: Conflict): Promise<void> {
    this.conflicts.set(conflict.id, conflict);
  }

  async putResolution(resolution: ConflictResolution): Promise<void> {
    this.resolutions.set(resolution.id, resolution);
  }

  async listConflicts(filter: { tenantId: TenantId }): Promise<readonly Conflict[]> {
    return [...this.conflicts.values()].filter((conflict) =>
      matchesTenant(conflict, filter.tenantId),
    );
  }

  async listResolutions(filter: { tenantId: TenantId }): Promise<readonly ConflictResolution[]> {
    return [...this.resolutions.values()].filter((resolution) =>
      matchesTenant(resolution, filter.tenantId),
    );
  }

  async appendEvent(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }

  async listEvents(): Promise<readonly DomainEvent[]> {
    return [...this.events];
  }

  async appendOutbox(event: DomainEvent): Promise<void> {
    this.outbox.push(event);
  }

  async listOutbox(): Promise<readonly DomainEvent[]> {
    return [...this.outbox];
  }

  async ackOutbox(eventId: EventId): Promise<void> {
    const index = this.outbox.findIndex((event) => event.eventId === eventId);
    if (index >= 0) {
      this.outbox.splice(index, 1);
    }
  }

  async putEmbedding(input: EmbeddingRow): Promise<void> {
    this.embeddings.set(input.claimId, input.vector);
  }

  async listEmbeddings(): Promise<readonly EmbeddingRow[]> {
    return [...this.embeddings.entries()].map(([claimId, vector]) => ({ claimId, vector }));
  }

  async clearEmbeddings(): Promise<void> {
    this.embeddings.clear();
  }

  async searchLexical(
    input: ClaimReadFilter & {
      query: string;
      limit: number;
    },
  ): Promise<readonly Claim[]> {
    const claims = await this.listClaims(input);
    return rankClaimsLexically({
      claims,
      query: input.query,
      tenantId: input.tenantId,
      namespaceId: input.namespaceId,
      limit: input.limit,
    });
  }

  async rebuildLexicalProjection(): Promise<void> {
    return;
  }

  private rememberCurrentClaim(id: ClaimId): void {
    const current = this.claims.get(id);
    if (current === undefined) {
      return;
    }
    const history = this.claimHistory.get(id) ?? [];
    history.push(current);
    this.claimHistory.set(id, history);
  }
}

class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<{ uri: string }> {
    this.objects.set(key, { bytes, contentType });
    return { uri: `memory://${key}` };
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
    return this.objects.get(key);
  }
}

export function createMemoryCanonicalStore(): CanonicalStore {
  return new MemoryCanonicalStore();
}

export function createMemoryBlobStore(): BlobStore {
  return new MemoryBlobStore();
}
