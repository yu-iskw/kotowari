import type {
  EntityId,
  EventId,
  IsoTimestamp,
  PrincipalId,
} from './branded-ids.js';
import type { Provenance } from './provenance.js';
import type { ScopedMetadata } from './scoped-metadata.js';

export const ENTITY_RESOLUTION_SIGNAL_KINDS = [
  'external-id-exact',
  'label-exact',
  'alias-exact',
  'strong-token-overlap',
  'partial-token-overlap',
  'substring',
] as const;

export type EntityResolutionSignalKind = (typeof ENTITY_RESOLUTION_SIGNAL_KINDS)[number];

export type EntityResolutionSignal = {
  kind: EntityResolutionSignalKind;
  score: number;
  source: string;
  candidate: string;
  detail: string;
};

/**
 * The proposal id is the id of the immutable domain event that first recorded it.
 */
export type EntityResolutionProposal = ScopedMetadata & {
  id: EventId;
  sourceEntityId: EntityId;
  candidateEntityId: EntityId;
  score: number;
  signals: readonly EntityResolutionSignal[];
  resolverVersion: string;
  proposedBy: PrincipalId;
  proposedAt: IsoTimestamp;
  provenance: Provenance;
};

export type EntityResolutionDecisionOutcome = 'approved' | 'rejected';

/**
 * The decision id is the id of the immutable domain event that records the review decision.
 */
export type EntityResolutionDecision = ScopedMetadata & {
  id: EventId;
  proposalId: EventId;
  outcome: EntityResolutionDecisionOutcome;
  reason: string;
  decidedBy: PrincipalId;
  decidedAt: IsoTimestamp;
  provenance: Provenance;
};

export type EntityMergeLineage = ScopedMetadata & {
  mergeEventId: EventId;
  resolutionProposalId?: EventId;
  survivingEntityId: EntityId;
  absorbedEntityIds: readonly EntityId[];
  reason?: string;
  recordedAt: IsoTimestamp;
  provenance: Provenance;
  revertedByEventId?: EventId;
  revertedAt?: IsoTimestamp;
  revertReason?: string;
};
