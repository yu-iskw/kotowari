import type { EntityId, IsoTimestamp } from './branded-ids.js';
import type { Provenance } from './provenance.js';
import type { ScopedMetadata } from './scoped-metadata.js';

export type Entity = ScopedMetadata & {
  id: EntityId;
  labels: readonly string[];
  aliases: readonly string[];
  recordedAt: IsoTimestamp;
  provenance: Provenance;
};
