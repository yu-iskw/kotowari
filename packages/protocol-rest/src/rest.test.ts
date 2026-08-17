import { describe, expect, it } from 'vitest';

import { handleRest } from './public.js';

import type { KotowariApp } from '@kotowari/application';

function capturingApp(): {
  app: KotowariApp;
  ingested: { relativePath: string; bytes: Uint8Array; mimeType: string }[];
} {
  const ingested: { relativePath: string; bytes: Uint8Array; mimeType: string }[] = [];
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
    listDecisions: async () => [],
    recordMemory: async () => ({ id: 'm1' }) as never,
    searchMemory: async () => [],
    putPolicy: async () => ({}) as never,
    whatIfPolicy: async () => [],
    resolveConflict: async () => ({}) as never,
    exportProvO: async () => ({}) as never,
    listPredicates: async () => [],
    listPolicies: async () => [],
    health: () => ({ ok: true as const, profile: 'standalone' as const }),
    currentPrincipal: async () => ({}) as never,
  } satisfies KotowariApp;
  return { app, ingested };
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
