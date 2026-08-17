export const PACKAGE_NAME = '@kotowari/capability-ingestion' as const;

export { CapabilityIngestionError } from './errors.js';
export type { CapabilityIngestionContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { documentMimeType, ingestDocuments } from './ingest.js';
export {
  asIngestBody,
  hasInlineIngestDocuments,
  ingestPathFromBody,
  parseIngestJson,
} from './parse-ingest-json.js';
export type { IngestDeps, IngestDocument, IngestResult } from './ingest.js';
