import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { DEV_OIDC_GUEST_TOKEN, DEV_OIDC_LOCAL_TOKEN } from '@kotowari/adapter-fs';
import { describe, expect, it } from 'vitest';

import { startComposeServer } from './compose.js';
import { collectGuestOmitSnapshot, collectParitySnapshot, semanticParityEqual } from './parity.js';
import { createStandaloneApp, runKotowariMcpStdio, startKotowariServer } from './public.js';

function tempDocs(): string {
  const docs = mkdtempSync(join(tmpdir(), 'docs-'));
  writeFileSync(join(docs, 'note.md'), 'Alice Chen is CEO of Vendor X as of 2024.\n');
  return docs;
}

describe('S1 S4 MCP stdio', () => {
  it('S12 kotowari mcp --profile retrieve lists tools without admin', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kotowari-'));
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: Buffer[] = [];
    stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    const running = runKotowariMcpStdio({
      argv: ['--profile', 'retrieve'],
      dataDir,
      stdin,
      stdout,
    });
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })}\n`);
    stdin.end();
    await running;
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      result: { tools: { name: string }[] };
    };
    const names = payload.result.tools.map((tool) => tool.name);
    expect(names).toEqual([
      'search_knowledge',
      'search_memory',
      'record_decision',
      'search_decisions',
    ]);
    expect(names).not.toContain('list_policies');
  });
});

describe('S2 evidence HTTP click-through', () => {
  it('S2 GET evidence content returns stored markdown bytes', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kotowari-'));
    const docs = tempDocs();
    const started = await startKotowariServer({ dataDir, port: 0 });
    try {
      const ingest = await fetch(`${started.url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: docs }),
      });
      const ingested = (await ingest.json()) as { evidenceIds: string[] };
      const evidenceId = ingested.evidenceIds[0];
      expect(evidenceId).toBeDefined();
      const content = await fetch(`${started.url}/v1/evidence/${evidenceId ?? ''}/content`);
      const json = (await content.json()) as { text?: string };
      expect(json.text).toContain('Vendor X');
    } finally {
      await started.close();
    }
  });
});

describe('S5 S7 ADR-0005 in-process compose parity', () => {
  it('S5 S7 standalone and in-process compose share semantic ingest/search/decision proofs', async () => {
    const docs = tempDocs();
    const standaloneDir = mkdtempSync(join(tmpdir(), 'kotowari-'));
    const standalone = await startKotowariServer({ dataDir: standaloneDir, port: 0 });
    const compose = await startComposeServer({ port: 0 });
    try {
      const left = await collectParitySnapshot(standalone.url, { ingestPath: docs });
      const right = await collectParitySnapshot(compose.url, {
        ingestPath: docs,
        bearer: DEV_OIDC_LOCAL_TOKEN,
      });
      expect(left.claimCount).toBeGreaterThan(0);
      expect(left.claimHasProvenance).toBe(true);
      expect(left.decisionHasProvenance).toBe(true);
      expect(left.decisionRoundTrip).toBe(true);
      expect(right.profile).toBe('compose');
      expect(semanticParityEqual(left, right)).toBe(true);
    } finally {
      await standalone.close();
      await compose.close();
    }
  });

  it('S10 ADR-0010 compose guest Bearer is retrieve-deny with policy_filter', async () => {
    const docs = tempDocs();
    const compose = await startComposeServer({ port: 0 });
    try {
      await collectParitySnapshot(compose.url, {
        ingestPath: docs,
        bearer: DEV_OIDC_LOCAL_TOKEN,
      });
      const omitted = await collectGuestOmitSnapshot(compose.url, {
        bearer: DEV_OIDC_GUEST_TOKEN,
      });
      expect(omitted.hitCount).toBe(0);
      expect(omitted.omittedHasPolicyFilter).toBe(true);
    } finally {
      await compose.close();
    }
  });
});

describe('standalone processQueuedJobs', () => {
  it('drains ingest.documents after a filesystem ingest', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kotowari-'));
    const docs = tempDocs();
    const app = createStandaloneApp({ dataDir });
    await app.ingestPath?.(docs);
    expect(await app.processQueuedJobs()).toBeGreaterThan(0);
    expect(await app.processQueuedJobs()).toBe(0);
  });
});
