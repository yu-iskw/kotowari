import type { EntityId, IsoTimestamp } from './branded-ids.js';
import type { Provenance } from './provenance.js';
import type { ScopedMetadata } from './scoped-metadata.js';

export type EntityExternalId = {
  system: string;
  value: string;
};

export type Entity = ScopedMetadata & {
  id: EntityId;
  labels: readonly string[];
  aliases: readonly string[];
  externalIds?: readonly EntityExternalId[];
  recordedAt: IsoTimestamp;
  provenance: Provenance;
};
