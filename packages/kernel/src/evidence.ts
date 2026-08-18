import type { EvidenceId, IsoTimestamp } from './branded-ids.js';
import type { Provenance } from './provenance.js';
import type { ScopedMetadata } from './scoped-metadata.js';

export type Evidence = ScopedMetadata & {
  id: EvidenceId;
  uri: string;
  contentHash: string;
  mimeType: string;
  title?: string;
  recordedAt: IsoTimestamp;
  provenance: Provenance;
};
