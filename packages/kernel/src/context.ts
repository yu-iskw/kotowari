import type {
  ClaimId,
  ContextId,
  EvidenceId,
  IsoTimestamp,
  NamespaceId,
  PolicyId,
  PolicyVersionId,
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
  policyVersionId: PolicyVersionId;
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
  /** Canonical for newly created snapshots; optional only to decode pre-migration snapshots. */
  policyVersions?: readonly PolicyVersionRef[];
  /** @deprecated Compatibility field for snapshots created before typed policy version refs. */
  policyVersionIds?: readonly string[];
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
  versionId: PolicyVersionId;
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
