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
  Principal,
  TenantId,
} from './contracts.js';

export type ModelCapabilities = {
  tools: boolean;
  structuredOutput: boolean;
  images: boolean;
  audio: boolean;
  reasoning: boolean;
  embeddings: boolean;
  maxContextTokens?: number;
};

export type GenerateRequest = {
  prompt: string;
  system?: string;
};

export type GenerateResult = {
  text: string;
};

export type ExtractedClaimDraft = {
  subjectLabel: string;
  predicate: string;
  objectLiteral: string;
  confidence: number;
};

export interface CanonicalStore {
  withTransaction<T>(fn: (tx: CanonicalStore) => Promise<T>): Promise<T>;
  putEntity(entity: Entity): Promise<void>;
  getEntity(id: EntityId): Promise<Entity | undefined>;
  putEvidence(evidence: Evidence): Promise<void>;
  getEvidence(id: EvidenceId): Promise<Evidence | undefined>;
  assertClaim(claim: Claim): Promise<void>;
  getClaim(id: ClaimId): Promise<Claim | undefined>;
  listClaims(filter: {
    tenantId: TenantId;
    namespaceId?: NamespaceId;
    asOf?: string;
  }): Promise<readonly Claim[]>;
  retractClaim(claim: Claim): Promise<void>;
  putDecision(decision: Decision): Promise<void>;
  getDecision(id: DecisionId): Promise<Decision | undefined>;
  listDecisions(filter: {
    tenantId: TenantId;
    namespaceId?: NamespaceId;
  }): Promise<readonly Decision[]>;
  putContextSnapshot(snapshot: ContextSnapshot): Promise<void>;
  getContextSnapshot(id: ContextId): Promise<ContextSnapshot | undefined>;
  putMemory(record: MemoryRecord): Promise<void>;
  listMemory(filter: {
    tenantId: TenantId;
    namespaceId?: NamespaceId;
  }): Promise<readonly MemoryRecord[]>;
  putPolicy(policy: PolicyRecord): Promise<void>;
  getPolicy(id: PolicyId): Promise<PolicyRecord | undefined>;
  listPolicies(filter: { tenantId: TenantId }): Promise<readonly PolicyRecord[]>;
  putConflict(conflict: Conflict): Promise<void>;
  putResolution(resolution: ConflictResolution): Promise<void>;
  listConflicts(filter: { tenantId: TenantId }): Promise<readonly Conflict[]>;
  listResolutions(filter: { tenantId: TenantId }): Promise<readonly ConflictResolution[]>;
  appendEvent(event: DomainEvent): Promise<void>;
  listEvents(): Promise<readonly DomainEvent[]>;
  appendOutbox(event: DomainEvent): Promise<void>;
  listOutbox(): Promise<readonly DomainEvent[]>;
  ackOutbox(eventId: EventId): Promise<void>;
  putEmbedding(input: { claimId: ClaimId; vector: readonly number[] }): Promise<void>;
  listEmbeddings(): Promise<readonly { claimId: ClaimId; vector: readonly number[] }[]>;
  clearEmbeddings(): Promise<void>;
  searchLexical(input: {
    tenantId: TenantId;
    namespaceId?: NamespaceId;
    query: string;
    limit: number;
    asOf?: string;
  }): Promise<readonly Claim[]>;
  rebuildLexicalProjection(): Promise<void>;
}

export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<{ uri: string }>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | undefined>;
}

export interface Queue {
  enqueue(job: { kind: string; payload: Record<string, unknown> }): Promise<void>;
  drain(): Promise<readonly { kind: string; payload: Record<string, unknown> }[]>;
}

export interface IdentityProvider {
  currentPrincipal(): Promise<Principal>;
  authenticate?(headers: Record<string, string | undefined>): Promise<Principal>;
}

export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;
  generate(request: GenerateRequest): Promise<GenerateResult>;
}

export interface EmbeddingProvider {
  readonly id: string;
  embed(request: {
    texts: readonly string[];
  }): Promise<{ vectors: readonly (readonly number[])[] }>;
}

export interface ExtractionProvider {
  readonly id: string;
  extract(request: {
    text: string;
    evidenceId: EvidenceId;
  }): Promise<{ drafts: readonly ExtractedClaimDraft[] }>;
}

export interface RerankerProvider {
  readonly id: string;
  rerank(request: {
    query: string;
    hits: readonly { id: string; text: string }[];
  }): Promise<{ ids: readonly string[] }>;
}
