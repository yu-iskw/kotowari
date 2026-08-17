import type { ClaimId, EntityId, EvidenceId, IsoTimestamp } from './branded-ids.js';
import type { Provenance } from './provenance.js';
import type { ScopedMetadata } from './scoped-metadata.js';

export const CLAIM_STATUSES = ['asserted', 'retracted', 'superseded', 'conflicted'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export type ClaimObject =
  | { kind: 'entity'; entityId: EntityId }
  | { kind: 'literal'; value: string; datatype?: string };

export type Bitemporal = {
  validFrom: IsoTimestamp;
  validTo?: IsoTimestamp;
  recordedAt: IsoTimestamp;
  assertedAt: IsoTimestamp;
};

export type Claim = ScopedMetadata & {
  id: ClaimId;
  subject: EntityId;
  predicate: string;
  object: ClaimObject;
  bitemporal: Bitemporal;
  confidence: number;
  status: ClaimStatus;
  evidenceIds: readonly EvidenceId[];
  provenance: Provenance;
  extractor?: string;
  model?: string;
  extractionVersion?: string;
};

export function claimObjectsEqual(left: ClaimObject, right: ClaimObject): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === 'entity' && right.kind === 'entity') {
    return left.entityId === right.entityId;
  }
  if (left.kind === 'literal' && right.kind === 'literal') {
    return left.value === right.value && left.datatype === right.datatype;
  }
  return false;
}

export function validityOverlaps(left: Bitemporal, right: Bitemporal): boolean {
  const leftEnd = left.validTo ?? '9999-12-31T23:59:59.999Z';
  const rightEnd = right.validTo ?? '9999-12-31T23:59:59.999Z';
  return left.validFrom <= rightEnd && right.validFrom <= leftEnd;
}

export function detectClaimOverlap(left: Claim, right: Claim): boolean {
  if (left.id === right.id) {
    return false;
  }
  if (left.status === 'retracted' || right.status === 'retracted') {
    return false;
  }
  if (left.subject !== right.subject || left.predicate !== right.predicate) {
    return false;
  }
  if (claimObjectsEqual(left.object, right.object)) {
    return false;
  }
  return validityOverlaps(left.bitemporal, right.bitemporal);
}
