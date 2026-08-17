import type { IsoTimestamp, MemoryId, PrincipalId } from './branded-ids.js';
import type { Provenance } from './provenance.js';
import type { ScopedMetadata } from './scoped-metadata.js';

export type MemoryRecord = ScopedMetadata & {
  id: MemoryId;
  kind: 'observation' | 'note' | 'thread';
  body: string;
  actor: PrincipalId;
  recordedAt: IsoTimestamp;
  provenance: Provenance;
};
