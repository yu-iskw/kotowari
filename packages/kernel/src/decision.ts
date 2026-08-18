import type {
  ContextId,
  DecisionId,
  EvidenceId,
  IsoTimestamp,
  PolicyId,
  PrincipalId,
} from './branded-ids.js';
import type { ContextSnapshot, PolicyEvaluation } from './context.js';
import type { Provenance } from './provenance.js';
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
  query?: string;
  resultingActionIds: readonly string[];
  observedOutcome?: string;
  policyEvaluations: readonly PolicyEvaluation[];
  recordedAt: IsoTimestamp;
  provenance: Provenance;
};
