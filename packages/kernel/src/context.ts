import type {
  ClaimId,
  ContextId,
  EvidenceId,
  IsoTimestamp,
  NamespaceId,
  PolicyId,
  RetrievalReceiptId,
} from './branded-ids.js';
import type { Provenance } from './provenance.js';
import type { Classification, ScopedMetadata } from './scoped-metadata.js';
import type { TemporalPerspective } from './temporal.js';

export type ContextSliceItem = {
  claimId: ClaimId;
  evidenceIds: readonly EvidenceId[];
};

export type PolicyVersionRef = {
  policyId: PolicyId;
  policyVersionId: PolicyId;
  version: number;
};

export type ContextSnapshot = ScopedMetadata & {
  id: ContextId;
  capturedAt: IsoTimestamp;
  purpose: string;
  temporal: TemporalPerspective;
  retrievalReceiptId?: RetrievalReceiptId;
  namespaceIds: readonly NamespaceId[];
  claimIds: readonly ClaimId[];
  evidenceIds: readonly EvidenceId[];
  policyVersionIds: readonly string[];
  policyVersions?: readonly PolicyVersionRef[];
  items: readonly ContextSliceItem[];
  budget: number;
};

export type PolicyRules = {
  minConfidence?: number;
  allowedOutcomes?: readonly string[];
  maxClassification?: Classification;
};

export type PolicyRecord = ScopedMetadata & {
  id: PolicyId;
  version: number;
  name: string;
  rules: PolicyRules;
};

export type Policy = ScopedMetadata & {
  id: PolicyId;
  name: string;
  description?: string;
  createdAt: IsoTimestamp;
};

export type PolicyStatus = 'draft' | 'active' | 'retired';

export type PolicyApplicability = {
  purposes?: readonly string[];
  namespaceIds?: readonly NamespaceId[];
  classifications?: readonly Classification[];
};

export type PolicyVersion = PolicyRecord & {
  policyId: PolicyId;
  status: PolicyStatus;
  effectiveFrom?: IsoTimestamp;
  effectiveTo?: IsoTimestamp;
  applicability: PolicyApplicability;
};

export type PolicyEvaluation = ScopedMetadata & {
  policyId: PolicyId;
  policyVersion: number;
  compliant: boolean;
  violations: readonly string[];
  provenance: Provenance;
};
