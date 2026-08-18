import type { IngestDocument } from './ingest.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function parseOneDocument(value: unknown): IngestDocument | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const relativePath = asString(value['relativePath'], asString(value['path'], 'untitled.txt'));
  const mimeType = asString(value['mimeType'], 'text/plain');
  if (typeof value['text'] !== 'string') {
    return undefined;
  }
  return { relativePath, mimeType, bytes: new TextEncoder().encode(value['text']) };
}

export function hasInlineIngestDocuments(body: Record<string, unknown>): boolean {
  return Array.isArray(body['documents']) || typeof body['text'] === 'string';
}

export function ingestPathFromBody(body: Record<string, unknown>): string {
  return asString(body['path']);
}

export function parseIngestJson(body: unknown): IngestDocument[] {
  if (!isRecord(body)) {
    return [];
  }
  const documents = body['documents'];
  if (Array.isArray(documents)) {
    const parsed: IngestDocument[] = [];
    for (const item of documents) {
      const document = parseOneDocument(item);
      if (document !== undefined) {
        parsed.push(document);
      }
    }
    return parsed;
  }
  const single = parseOneDocument(body);
  return single === undefined ? [] : [single];
}

export function asIngestBody(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}
