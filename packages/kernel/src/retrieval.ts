import type { ClaimId, EvidenceId, IsoTimestamp, RetrievalReceiptId } from './branded-ids.js';
import type { Provenance } from './provenance.js';
import type { ScopedMetadata } from './scoped-metadata.js';
import type { TemporalPerspective } from './temporal.js';

export type RetrievalScoreComponents = {
  lexical?: number;
  vector?: number;
  graph?: number;
};

export type RetrievalReceiptSelection = {
  claimId: ClaimId;
  evidenceIds: readonly EvidenceId[];
  score: number;
  scoreComponents: RetrievalScoreComponents;
};

export type RetrievalReceiptOmission = {
  reason: 'policy_filter';
  classification: string;
  count: number;
};

export type RetrievalReceipt = ScopedMetadata & {
  id: RetrievalReceiptId;
  queryHash: string;
  purpose?: string;
  temporal: TemporalPerspective;
  planVersion: string;
  selected: readonly RetrievalReceiptSelection[];
  omissions: readonly RetrievalReceiptOmission[];
  executedAt: IsoTimestamp;
  provenance: Provenance;
};
