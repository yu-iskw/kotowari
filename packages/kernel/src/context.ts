import type { ClaimId, ContextId, EvidenceId, IsoTimestamp, NamespaceId, PolicyId } from './branded-ids.js';
import type { Provenance } from './provenance.js';
import type { Classification, ScopedMetadata } from './scoped-metadata.js';

export type ContextSliceItem = {
  claimId: ClaimId;
  evidenceIds: readonly EvidenceId[];
};

export type ContextSnapshot = ScopedMetadata & {
  id: ContextId;
  capturedAt: IsoTimestamp;
  purpose: string;
  namespaceIds: readonly NamespaceId[];
  claimIds: readonly ClaimId[];
  evidenceIds: readonly EvidenceId[];
  policyVersionIds: readonly string[];
  items: readonly ContextSliceItem[];
  budget: number;
};

export type PolicyRecord = ScopedMetadata & {
  id: PolicyId;
  version: number;
  name: string;
  rules: PolicyRules;
};

export type PolicyRules = {
  minConfidence?: number;
  allowedOutcomes?: readonly string[];
  maxClassification?: Classification;
};

export type PolicyEvaluation = ScopedMetadata & {
  policyId: PolicyId;
  policyVersion: number;
  compliant: boolean;
  violations: readonly string[];
  provenance: Provenance;
};
