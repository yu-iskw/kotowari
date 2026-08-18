import type { AuthorizationReceipt } from './authorization.js';
import type {
  ApprovalRecordId,
  AuditBundleId,
  ContextId,
  DecisionId,
  DecisionRelationId,
  EvidenceId,
  IsoTimestamp,
  OutcomeObservationId,
  PolicyExceptionId,
  PolicyId,
  PolicyVersionId,
  PrincipalId,
} from './branded-ids.js';
import type { Claim } from './claim.js';
import type { ContextSnapshot, PolicyEvaluation, PolicyRecord } from './context.js';
import type { DomainEvent } from './events.js';
import type { Evidence } from './evidence.js';
import type { Provenance } from './provenance.js';
import type { RetrievalReceipt } from './retrieval.js';
import type { ScopedMetadata } from './scoped-metadata.js';

export type Decision = ScopedMetadata & {
  id: DecisionId;
  inputContextSnapshotId: ContextId;
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
  /** @deprecated Outcomes are immutable OutcomeObservation records. */
  observedOutcome?: string;
  policyEvaluations: readonly PolicyEvaluation[];
  recordedAt: IsoTimestamp;
  provenance: Provenance;
};

export type DecisionRelationKind =
  'depends_on' | 'supersedes' | 'precedent_for' | 'caused' | 'informed_by';

export type DecisionRelation = ScopedMetadata & {
  id: DecisionRelationId;
  fromDecisionId: DecisionId;
  toDecisionId: DecisionId;
  kind: DecisionRelationKind;
  recordedAt: IsoTimestamp;
  provenance: Provenance;
};

export type OutcomeMetricValue = string | number | boolean | null;

export type OutcomeObservation = ScopedMetadata & {
  id: OutcomeObservationId;
  decisionId: DecisionId;
  observedAt: IsoTimestamp;
  outcome: string;
  metrics: Readonly<Record<string, OutcomeMetricValue>>;
  evidenceIds: readonly EvidenceId[];
  provenance: Provenance;
};

export type PolicyException = ScopedMetadata & {
  id: PolicyExceptionId;
  decisionId: DecisionId;
  policyVersionId: PolicyVersionId;
  reason: string;
  approvedBy?: PrincipalId;
  recordedAt: IsoTimestamp;
  provenance: Provenance;
};

export type ApprovalStatus = 'approved' | 'rejected';

export type ApprovalRecord = ScopedMetadata & {
  id: ApprovalRecordId;
  decisionId: DecisionId;
  approver: PrincipalId;
  status: ApprovalStatus;
  method?: string;
  context?: string;
  recordedAt: IsoTimestamp;
  provenance: Provenance;
};

export type DecisionAuditManifest = {
  schemaVersion: 'decision-audit-v1';
  generatedAt: IsoTimestamp;
  contentHashes: Readonly<Record<string, string>>;
};

export type DecisionAuditBundle = {
  id: AuditBundleId;
  decision: Decision;
  contextSnapshot: ContextSnapshot;
  retrievalReceipt?: RetrievalReceipt;
  claims: readonly Claim[];
  evidence: readonly Evidence[];
  policyVersions: readonly PolicyRecord[];
  authorizationReceipts: readonly AuthorizationReceipt[];
  relations: readonly DecisionRelation[];
  outcomes: readonly OutcomeObservation[];
  exceptions: readonly PolicyException[];
  approvals: readonly ApprovalRecord[];
  events: readonly DomainEvent[];
  manifest: DecisionAuditManifest;
};
