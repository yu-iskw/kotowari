import type { ClaimId, EntityId, EvidenceId, IsoTimestamp, PolicyId, PrincipalId } from './branded-ids.js';
import type { ClaimObject, ClaimStatus } from './claim.js';
import type { ConflictKind, ResolutionStrategy } from './conflict.js';
import type { ContextSnapshot, PolicyEvaluation, PolicyRules } from './context.js';
import type { Provenance } from './provenance.js';
import type { Classification, ScopedMetadata } from './scoped-metadata.js';

export type AssertClaimInput = {
  metadata: ScopedMetadata;
  subject: EntityId;
  predicate: string;
  object: ClaimObject;
  validFrom: IsoTimestamp;
  validTo?: IsoTimestamp;
  assertedAt: IsoTimestamp;
  confidence: number;
  evidenceIds: readonly EvidenceId[];
  provenance: Provenance;
  extractor?: string;
  model?: string;
  extractionVersion?: string;
  status?: ClaimStatus;
};

export type RetractClaimInput = {
  claimId: ClaimId;
  provenance: Provenance;
};

export type InsertEvidenceInput = {
  metadata: ScopedMetadata;
  uri: string;
  contentHash: string;
  mimeType: string;
  title?: string;
  provenance: Provenance;
};

export type MergeEntityInput = {
  metadata: ScopedMetadata;
  survivingEntityId: EntityId;
  absorbedEntityIds: readonly EntityId[];
  provenance: Provenance;
};

export type RecordDecisionInput = {
  metadata: ScopedMetadata;
  inputContextSnapshot: ContextSnapshot;
  consideredEvidenceIds: readonly EvidenceId[];
  applicablePolicyIds: readonly PolicyId[];
  selectedOutcome: string;
  alternatives: readonly string[];
  confidence: number;
  actor: PrincipalId;
  model?: string;
  runtimeId?: string;
  rationale?: string;
  resultingActionIds: readonly string[];
  observedOutcome?: string;
  policyEvaluations: readonly PolicyEvaluation[];
  provenance: Provenance;
};

export type EvaluatePolicyInput = {
  metadata: ScopedMetadata;
  policyId: PolicyId;
  policyVersion: number;
  name: string;
  rules: PolicyRules;
  candidateOutcome?: string;
  confidence?: number;
  classification?: Classification;
  provenance: Provenance;
};

export type ResolveConflictInput = {
  metadata: ScopedMetadata;
  kind: ConflictKind;
  claimIds: readonly ClaimId[];
  strategy: ResolutionStrategy;
  preferredClaimId: ClaimId;
  reason: string;
  provenance: Provenance;
};

export type PutEntityInput = {
  metadata: ScopedMetadata;
  labels: readonly string[];
  aliases?: readonly string[];
  provenance: Provenance;
};

export type SemanticWriteInput =
  | { kind: 'claim.asserted'; input: AssertClaimInput }
  | { kind: 'claim.retracted'; input: RetractClaimInput }
  | { kind: 'evidence.inserted'; input: InsertEvidenceInput }
  | { kind: 'entity.merged'; input: MergeEntityInput }
  | { kind: 'decision.recorded'; input: RecordDecisionInput }
  | { kind: 'policy.evaluated'; input: EvaluatePolicyInput }
  | { kind: 'conflict.resolved'; input: ResolveConflictInput };
