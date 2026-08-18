import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';

import { DEV_OIDC_GUEST_TOKEN } from '@kotowari/adapter-fs';
import { describe, expect, it } from 'vitest';

import { createInProcessComposeApp, startComposeServer } from './compose.js';
import { collectParitySnapshot, semanticParityEqual } from './parity.js';
import { createStandaloneApp, runKotowariMcpStdio, startKotowariServer } from './public.js';

const MCP_META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'kotowari-test', version: '1.0.0' },
  'io.modelcontextprotocol/clientCapabilities': {},
} as const;

function tempDocs(): string {
  const docs = mkdtempSync(join(tmpdir(), 'docs-'));
  writeFileSync(join(docs, 'note.md'), 'Alice Chen is CEO of Vendor X as of 2024.\n');
  return docs;
}

describe('S1 S4 MCP 2026-07-28 stdio', () => {
  it('S12 retrieve profile is modern-only and strictly read-only', async () => {
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
    stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'discover',
        method: 'server/discover',
        params: { _meta: MCP_META },
      })}\n`,
    );
    stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'tools',
        method: 'tools/list',
        params: { _meta: MCP_META },
      })}\n`,
    );
    stdin.end();
    await running;

    const messages = Buffer.concat(chunks)
      .toString('utf8')
      .trim()
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as { id?: string; result?: Record<string, unknown> });
    const discover = messages.find((message) => message.id === 'discover');
    expect(discover?.result?.['supportedVersions']).toContain('2026-07-28');

    const toolsMessage = messages.find((message) => message.id === 'tools');
    const tools = (toolsMessage?.result?.['tools'] ?? []) as { name: string }[];
    expect(tools.map((tool) => tool.name)).toEqual(['search_knowledge', 'search_memory']);
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

describe('Phase 2 in-process compose parity', () => {
  it('standalone and in-process compose share semantic ingest/search/decision proofs', async () => {
    const docs = tempDocs();
    const standaloneDir = mkdtempSync(join(tmpdir(), 'kotowari-'));
    const standalone = await startKotowariServer({ dataDir: standaloneDir, port: 0 });
    const compose = await startComposeServer({ port: 0 });
    try {
      const left = await collectParitySnapshot(standalone.url, { ingestPath: docs });
      const right = await collectParitySnapshot(compose.url, {
        ingestPath: docs,
        bearer: 'dev-local',
      });
      expect(left.claimCount).toBeGreaterThan(0);
      expect(right.profile).toBe('compose');
      expect(semanticParityEqual(left, right)).toBe(true);
    } finally {
      await standalone.close();
      await compose.close();
    }
  });

  it('S10 compose guest Bearer is retrieve-deny', async () => {
    const docs = tempDocs();
    const { app, close } = await createInProcessComposeApp();
    try {
      await app.runAsRequest({ authorization: 'Bearer dev-local' }, async () => {
        await app.ingestPath?.(docs);
      });
      const result = await app.runAsRequest(
        { authorization: `Bearer ${DEV_OIDC_GUEST_TOKEN}` },
        async () => app.searchKnowledge({ query: 'Vendor X', purpose: 'search' }),
      );
      expect(result.hits).toEqual([]);
      expect(result.omitted.length).toBeGreaterThan(0);
    } finally {
      await close();
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
