import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createStandaloneApp, ingestFilesystemPath, startKotowariServer } from './public.js';

describe('S1 S3 standalone smoke', () => {
  it('S1 serves health over HTTP without Docker', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kotowari-'));
    const started = await startKotowariServer({ dataDir, port: 0 });
    const response = await fetch(`${started.url}/v1/health`);
    const json = (await response.json()) as { ok: boolean };
    expect(json.ok).toBe(true);
    await started.close();
  });

  it('S3 decision survives sqlite file reopen', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kotowari-'));
    const docs = mkdtempSync(join(tmpdir(), 'docs-'));
    writeFileSync(
      join(docs, 'note.md'),
      'Vendor X is the payment processor for the HIPAA workload.\n',
    );
    const first = createStandaloneApp({ dataDir });
    await ingestFilesystemPath(first, docs);
    const decision = await first.recordDecision({
      purpose: 'library-choice',
      query: 'Vendor X',
      selectedOutcome: 'use_vendor_x',
      confidence: 0.9,
    });
    const second = createStandaloneApp({ dataDir });
    const loaded = await second.getDecision(decision.id);
    expect(loaded?.selectedOutcome).toBe('use_vendor_x');
  });

  it('S2 HTTP ingest path then sourced search', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kotowari-'));
    const docs = mkdtempSync(join(tmpdir(), 'docs-'));
    writeFileSync(join(docs, 'note.md'), 'Alice Chen is CEO of Vendor X as of 2024.\n');
    const started = await startKotowariServer({ dataDir, port: 0 });
    try {
      const ingest = await fetch(`${started.url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: docs }),
      });
      expect(ingest.status).toBe(202);
      const ingested = (await ingest.json()) as { claimIds: string[] };
      expect(ingested.claimIds.length).toBeGreaterThan(0);
      const search = await fetch(`${started.url}/v1/knowledge/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'Vendor X CEO', purpose: 'search' }),
      });
      const result = (await search.json()) as { hits: { evidenceIds: string[] }[] };
      expect(result.hits.length).toBeGreaterThan(0);
      expect(result.hits[0]?.evidenceIds.length).toBeGreaterThan(0);
    } finally {
      await started.close();
    }
  });
});
