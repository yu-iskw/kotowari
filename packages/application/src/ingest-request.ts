import {
  asIngestBody,
  hasInlineIngestDocuments,
  ingestPathFromBody,
  parseIngestJson,
} from '@kotowari/capability-ingestion';

import type { KotowariApp } from './create-app.js';
import type { IngestResult } from '@kotowari/capability-ingestion';

export type IngestDispatch = { ok: true; result: IngestResult } | { ok: false; error: string };

export async function dispatchIngest(app: KotowariApp, body: unknown): Promise<IngestDispatch> {
  const record = asIngestBody(body);
  if (hasInlineIngestDocuments(record) || ingestPathFromBody(record).length === 0) {
    return { ok: true, result: await app.ingestDocuments(parseIngestJson(record)) };
  }
  if (app.ingestPath === undefined) {
    return { ok: false, error: 'path ingest is only available in standalone' };
  }
  return { ok: true, result: await app.ingestPath(ingestPathFromBody(record)) };
}
