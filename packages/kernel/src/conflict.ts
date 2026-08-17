import type { ClaimId, ConflictId, IsoTimestamp } from './branded-ids.js';
import type { Provenance } from './provenance.js';
import type { ScopedMetadata } from './scoped-metadata.js';

export const CONFLICT_KINDS = ['value', 'type', 'temporal', 'logical'] as const;
export type ConflictKind = (typeof CONFLICT_KINDS)[number];

export const RESOLUTION_STRATEGIES = [
  'recency',
  'source_credibility',
  'majority',
  'human_review',
] as const;
export type ResolutionStrategy = (typeof RESOLUTION_STRATEGIES)[number];

export type Conflict = ScopedMetadata & {
  id: ConflictId;
  kind: ConflictKind;
  claimIds: readonly ClaimId[];
  recordedAt: IsoTimestamp;
};

export type ConflictResolution = ScopedMetadata & {
  id: ConflictId;
  claimIds: readonly ClaimId[];
  strategy: ResolutionStrategy;
  preferredClaimId: ClaimId;
  reason: string;
  provenance: Provenance;
  recordedAt: IsoTimestamp;
};
