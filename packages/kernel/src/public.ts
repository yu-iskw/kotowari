export {
  allow,
  allowWithReceipt,
  assertAllowed,
  localStandaloneMetadata,
  localStandalonePrincipal,
} from './authorization.js';
export type {
  Action,
  AuthContext,
  AuthDecision,
  AuthorizationReceipt,
  Delegation,
  Principal,
  Resource,
  ResourceKind,
} from './authorization.js';
export { ACTIONS } from './authorization.js';
export {
  asApprovalRecordId,
  asAuditBundleId,
  asClaimId,
  asConflictId,
  asContextId,
  asDecisionId,
  asDecisionRelationId,
  asEntityId,
  asEventId,
  asEvidenceId,
  asIsoTimestamp,
  asMemoryId,
  asNamespaceId,
  asOutcomeObservationId,
  asPolicyExceptionId,
  asPolicyId,
  asPolicyVersionId,
  asPrincipalId,
  asProvenanceId,
  asRetrievalReceiptId,
  asTenantId,
  newId,
} from './branded-ids.js';
export type {
  ApprovalRecordId,
  AuditBundleId,
  ClaimId,
  ConflictId,
  ContextId,
  DecisionId,
  DecisionRelationId,
  EntityId,
  EventId,
  EvidenceId,
  IsoTimestamp,
  MemoryId,
  NamespaceId,
  OutcomeObservationId,
  PolicyExceptionId,
  PolicyId,
  PolicyVersionId,
  PrincipalId,
  ProvenanceId,
  RetrievalReceiptId,
  TenantId,
} from './branded-ids.js';
export {
  CLAIM_STATUSES,
  claimKnownAt,
  claimObjectsEqual,
  claimText,
  claimValidAt,
  claimVisibleAt,
  detectClaimOverlap,
  validityOverlaps,
} from './claim.js';
export type { Bitemporal, Claim, ClaimObject, ClaimStatus } from './claim.js';
export { CONFLICT_KINDS, RESOLUTION_STRATEGIES } from './conflict.js';
export type {
  CardinalityConflictRule,
  Conflict,
  ConflictCause,
  ConflictKind,
  ConflictResolution,
  ResolutionStrategy,
} from './conflict.js';
export type {
  ContextSliceItem,
  ContextSnapshot,
  Policy,
  PolicyApplicability,
  PolicyEvaluation,
  PolicyRecord,
  PolicyRules,
  PolicyStatus,
  PolicyVersion,
  PolicyVersionRef,
} from './context.js';
export type {
  AssertClaimInput,
  EvaluatePolicyInput,
  InsertEvidenceInput,
  MergeEntityInput,
  PutEntityInput,
  RecordDecisionInput,
  ResolveConflictInput,
  RetractClaimInput,
  SemanticWriteInput,
} from './contracts.js';
export type {
  ApprovalRecord,
  ApprovalStatus,
  Decision,
  DecisionAuditBundle,
  DecisionAuditManifest,
  DecisionRelation,
  DecisionRelationKind,
  OutcomeMetricValue,
  OutcomeObservation,
  PolicyException,
} from './decision.js';
export { ENTITY_RESOLUTION_SIGNAL_KINDS } from './entity-resolution.js';
export type {
  EntityMergeLineage,
  EntityResolutionDecision,
  EntityResolutionDecisionOutcome,
  EntityResolutionProposal,
  EntityResolutionSignal,
  EntityResolutionSignalKind,
} from './entity-resolution.js';
export type { Entity, EntityExternalId } from './entity.js';
export { KernelError, KERNEL_ERROR_CODES } from './errors.js';
export type { KernelErrorCode } from './errors.js';
export { createEventId } from './events.js';
export type { DomainEvent, SemanticWriteKind } from './events.js';
export type { Evidence } from './evidence.js';
export {
  buildClaimAsserted,
  buildClaimRetracted,
  buildConflictResolved,
  buildContextSnapshot,
  buildDecisionRecorded,
  buildEntity,
  buildEntityMerged,
  buildEvidenceInserted,
  buildPolicyEvaluated,
  requireProvenance,
} from './invariants.js';
export type { MemoryRecord } from './memory.js';
export {
  assertNoChainOfThought,
  assertProvenance,
  compactProvenance,
  nowIso,
} from './provenance.js';
export type { Provenance } from './provenance.js';
export type {
  RetrievalReceipt,
  RetrievalReceiptOmission,
  RetrievalReceiptSelection,
  RetrievalScoreComponents,
} from './retrieval.js';
export {
  CLASSIFICATIONS,
  classificationRank,
  isClassification,
  VISIBILITIES,
} from './scoped-metadata.js';
export type { Classification, ScopedMetadata, Visibility } from './scoped-metadata.js';
export { normalizeTemporalPerspective } from './temporal.js';
export type { TemporalPerspective } from './temporal.js';
