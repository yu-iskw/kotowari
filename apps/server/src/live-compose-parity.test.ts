import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEV_OIDC_LOCAL_TOKEN } from '@kotowari/adapter-fs';
import { describe, expect, it } from 'vitest';

import { startComposeServer } from './compose.js';
import { collectParitySnapshot, semanticParityEqual } from './parity.js';
import { startKotowariServer } from './public.js';

const live = process.env['KOTOWARI_LIVE_COMPOSE'] === '1';

function tempDocs(): string {
  const docs = mkdtempSync(join(tmpdir(), 'docs-'));
  writeFileSync(join(docs, 'note.md'), 'Alice Chen is CEO of Vendor X as of 2024.\n');
  return docs;
}

describe.skipIf(!live)('S5 S7 live Compose Postgres and MinIO parity', () => {
  it('ADR-0005 standalone vs env compose share semantic proofs', async () => {
    const databaseUrl = process.env['DATABASE_URL'];
    if (databaseUrl === undefined || databaseUrl.length === 0) {
      throw new Error('DATABASE_URL is required for live compose parity');
    }
    const docs = tempDocs();
    const standaloneDir = mkdtempSync(join(tmpdir(), 'kotowari-'));
    const standalone = await startKotowariServer({ dataDir: standaloneDir, port: 0 });
    const compose = await startComposeServer({ port: 0, env: process.env });
    try {
      const left = await collectParitySnapshot(standalone.url, { ingestPath: docs });
      const right = await collectParitySnapshot(compose.url, {
        ingestPath: docs,
        bearer: DEV_OIDC_LOCAL_TOKEN,
      });
      expect(left.claimHasProvenance).toBe(true);
      expect(right.profile).toBe('compose');
      expect(semanticParityEqual(left, right)).toBe(true);
    } finally {
      await standalone.close();
      await compose.close();
    }
  });
});
