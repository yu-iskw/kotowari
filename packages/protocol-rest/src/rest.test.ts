import { describe, expect, it } from 'vitest';

import { handleRest } from './public.js';

import type { KotowariApp } from '@kotowari/application';

function capturingApp(): {
  app: KotowariApp;
  ingested: { relativePath: string; bytes: Uint8Array; mimeType: string }[];
  searchedDecisions: string[];
  listedDecisions: { count: number };
} {
  const ingested: { relativePath: string; bytes: Uint8Array; mimeType: string }[] = [];
  const searchedDecisions: string[] = [];
  const listedDecisions = { count: 0 };
  const app = {
    ingestDocuments: async (
      documents: readonly { relativePath: string; bytes: Uint8Array; mimeType: string }[],
    ) => {
      ingested.push(...documents);
      return { evidenceIds: ['e1'], claimIds: ['c1'], entityIds: [] };
    },
    ingestPath: async (target: string) => ({
      evidenceIds: [`path:${target}`],
      claimIds: [],
      entityIds: [],
    }),
    searchKnowledge: async () => ({
      hits: [],
      omitted: [],
      plan: { candidates: [], rerank: 'none' as const, budget: 20, explain: true },
    }),
    buildContext: async () => ({}) as never,
    recordDecision: async () => ({ id: 'd1' }) as never,
    getDecision: async () => undefined,
    listDecisions: async () => {
      listedDecisions.count += 1;
      return [];
    },
    searchDecisions: async (input: { query: string }) => {
      searchedDecisions.push(input.query);
      return [];
    },
    listConflicts: async () => [],
    listJobs: async () => [],
    recordMemory: async () => ({ id: 'm1' }) as never,
    searchMemory: async () => [],
    putPolicy: async () => ({}) as never,
    whatIfPolicy: async () => [],
    resolveConflict: async () => ({}) as never,
    exportProvO: async () => ({}) as never,
    listPredicates: async () => [],
    listPolicies: async () => [],
    getEvidence: async () => undefined,
    getEvidenceContent: async () => undefined,
    reextractFromEvidence: async () => ({ evidenceIds: [], claimIds: [], entityIds: [] }),
    processQueuedJobs: async () => 0,
    health: () => ({ ok: true as const, profile: 'standalone' as const }),
    currentPrincipal: async () => ({}) as never,
    runAsRequest: async <T>(_headers: Record<string, string | undefined>, fn: () => Promise<T>) =>
      fn(),
  } satisfies KotowariApp;
  return { app, ingested, searchedDecisions, listedDecisions };
}

describe('S2 REST ingest', () => {
  it('S2 POST /v1/ingest writes documents through ingestDocuments', async () => {
    const { app, ingested } = capturingApp();
    const result = await handleRest(app, {
      method: 'POST',
      pathname: '/v1/ingest',
      body: {
        relativePath: 'decision-note.md',
        text: 'Alice Chen is CEO.',
        mimeType: 'text/markdown',
      },
    });
    expect(result.status).toBe(202);
    expect(ingested).toHaveLength(1);
    expect(ingested[0]?.relativePath).toBe('decision-note.md');
    expect(new TextDecoder().decode(ingested[0]?.bytes)).toBe('Alice Chen is CEO.');
  });

  it('S2 POST /v1/ingest with path uses standalone ingestPath', async () => {
    const { app } = capturingApp();
    const result = await handleRest(app, {
      method: 'POST',
      pathname: '/v1/ingest',
      body: { path: '/tmp/corpus' },
    });
    expect(result.status).toBe(202);
    expect(result.json).toEqual({ evidenceIds: ['path:/tmp/corpus'], claimIds: [], entityIds: [] });
  });
});

describe('S17 S3 S5 REST surfaces', () => {
  it('GET /v1/conflicts and POST resolve go through the app', async () => {
    const { app } = capturingApp();
    const listed = await handleRest(app, { method: 'GET', pathname: '/v1/conflicts', body: {} });
    expect(listed.status).toBe(200);
    const resolved = await handleRest(app, {
      method: 'POST',
      pathname: '/v1/conflicts',
      body: { claimIds: ['c1', 'c2'], preferredClaimId: 'c1', reason: 'later filing' },
    });
    expect(resolved.status).toBe(201);
    const invalid = await handleRest(app, {
      method: 'POST',
      pathname: '/v1/conflicts',
      body: { claimIds: [], preferredClaimId: 'c1', reason: 'later filing' },
    });
    expect(invalid.status).toBe(400);
  });

  it('GET /v1/decisions?query uses searchDecisions', async () => {
    const captured = capturingApp();
    const result = await handleRest(captured.app, {
      method: 'GET',
      pathname: '/v1/decisions',
      body: { query: 'vendor X' },
    });
    expect(result.status).toBe(200);
    expect(captured.searchedDecisions).toEqual(['vendor X']);
    expect(captured.listedDecisions.count).toBe(0);
  });

  it('GET /v1/jobs lists pending work', async () => {
    const { app } = capturingApp();
    const result = await handleRest(app, { method: 'GET', pathname: '/v1/jobs', body: {} });
    expect(result.status).toBe(200);
    expect(result.json).toEqual([]);
  });
});
