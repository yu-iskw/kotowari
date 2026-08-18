import { describe, expect, it } from 'vitest';

import { handleRest } from './public.js';

import type { KotowariApp } from '@kotowari/application';

function capturingApp(): KotowariApp {
  return {
    ingestDocuments: async () => ({ evidenceIds: ['e1'], claimIds: ['c1'], entityIds: [] }),
    ingestPath: async (target: string) => ({
      evidenceIds: [`path:${target}`],
      claimIds: [],
      entityIds: [],
    }),
    searchKnowledge: async () => ({
      hits: [],
      omitted: [],
      plan: { candidates: [], rerank: 'none' as const, budget: 20, explain: true },
      receipt: {} as never,
    }),
    buildContext: async () => ({}) as never,
    recordDecision: async () => ({ id: 'd1' }) as never,
    getDecision: async (id: string) =>
      ({
        id,
        applicablePolicyIds: ['p1'],
        consideredEvidenceIds: ['e1'],
        selectedOutcome: 'use_vendor_x',
        actor: 'local-user',
        inputContextSnapshot: { purpose: 'search' },
      }) as never,
    listDecisions: async () => [],
    recordMemory: async () => ({ id: 'm1' }) as never,
    searchMemory: async () => [],
    putPolicy: async () => ({}) as never,
    whatIfPolicy: async () => [],
    resolveConflict: async () => ({}) as never,
    exportProvO: async (id: string) => ({ decisionId: id, '@type': 'prov:Activity' }) as never,
    listPredicates: async () => [],
    listPolicies: async () => [],
    getEvidence: async (id: string) => ({ id, uri: 'file://x', title: 'note.md' }) as never,
    getEvidenceContent: async (id: string) => ({
      evidence: { id, uri: 'file://x', title: 'note.md' } as never,
      bytes: new TextEncoder().encode('hello vendor'),
      contentType: 'text/markdown',
      text: 'hello vendor',
    }),
    reextractFromEvidence: async () => ({ evidenceIds: [], claimIds: [], entityIds: [] }),
    processQueuedJobs: async () => 0,
    health: () => ({ ok: true as const, profile: 'standalone' as const }),
    currentPrincipal: async () => ({}) as never,
    runAsRequest: async <T>(_headers: Record<string, string | undefined>, fn: () => Promise<T>) =>
      fn(),
  };
}

describe('S2 evidence REST and S8 PROV export', () => {
  it('S2 GET /v1/evidence/:id/content returns stored text', async () => {
    const result = await handleRest(capturingApp(), {
      method: 'GET',
      pathname: '/v1/evidence/e1/content',
      body: {},
    });
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ id: 'e1', text: 'hello vendor' });
  });

  it('S8 GET /v1/decisions/:id/prov returns PROV-O', async () => {
    const result = await handleRest(capturingApp(), {
      method: 'GET',
      pathname: '/v1/decisions/d1/prov',
      body: {},
    });
    expect(result.status).toBe(200);
    expect(result.json).toMatchObject({ '@type': 'prov:Activity' });
  });
});
