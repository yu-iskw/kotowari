import { describe, expect, it, vi } from 'vitest';

import {
  MCP_OPERATIONS,
  MCP_PROFILE_DEFINITIONS,
  MCP_PROFILES,
  invokeMcpOperation,
} from './public.js';

import type { KotowariApp } from '@kotowari/application';

function fakeApp(): KotowariApp {
  return {
    ingestDocuments: async () => ({ evidenceIds: [], claimIds: [], entityIds: [] }),
    ingestPath: async () => ({ evidenceIds: [], claimIds: [], entityIds: [] }),
    searchKnowledge: async () => ({
      hits: [],
      omitted: [],
      plan: { candidates: [], rerank: 'none', budget: 20, explain: true },
      receipt: {} as never,
    }),
    buildContext: async () => ({}) as never,
    recordDecision: async () => ({ id: 'd1' }) as never,
    getDecision: async () => undefined,
    listDecisions: async () => [],
    replayDecision: async () => undefined,
    getDecisionAuditBundle: async () => undefined,
    recordMemory: async () => ({ id: 'm1' }) as never,
    searchMemory: async () => [],
    putPolicy: async () => ({}) as never,
    whatIfPolicy: async () => [],
    resolveConflict: async () => ({}) as never,
    exportProvO: async () => ({}) as never,
    listPredicates: async () => [],
    listPolicies: async () => [],
    health: () => ({ ok: true, profile: 'standalone' }),
    currentPrincipal: async () => ({}) as never,
    getEvidence: async () => undefined,
    getEvidenceContent: async () => undefined,
    reextractFromEvidence: async () => ({ evidenceIds: [], claimIds: [], entityIds: [] }),
    processQueuedJobs: async () => 0,
    runAsRequest: async <T>(_headers: Record<string, string | undefined>, fn: () => Promise<T>) =>
      fn(),
  };
}

describe('MCP operation registry', () => {
  it('makes retrieve strictly read-only', () => {
    expect(MCP_PROFILE_DEFINITIONS.retrieve.risk).toBe('read');
    expect(MCP_PROFILE_DEFINITIONS.retrieve.tools).toEqual(['search_knowledge', 'search_memory']);
    for (const tool of MCP_PROFILE_DEFINITIONS.retrieve.tools) {
      expect(MCP_OPERATIONS[tool].risk).toBe('read');
    }
  });

  it('only references registered operations from profiles', () => {
    for (const profile of MCP_PROFILES) {
      for (const tool of MCP_PROFILE_DEFINITIONS[profile].tools) {
        expect(MCP_OPERATIONS[tool]).toBeDefined();
      }
    }
  });

  it('rejects malformed tool inputs instead of coercing values', async () => {
    await expect(
      invokeMcpOperation(fakeApp(), 'search_knowledge', { query: 42 }),
    ).rejects.toThrow();
  });

  it('forwards record_decision alternatives through the canonical contract', async () => {
    const app = fakeApp();
    const recordDecision = vi.fn(async () => ({ id: 'd1' }) as never);
    app.recordDecision = recordDecision;

    await invokeMcpOperation(app, 'record_decision', {
      purpose: 'release',
      selectedOutcome: 'ship',
      alternatives: ['wait', 'cancel'],
      confidence: 0.8,
    });

    expect(recordDecision).toHaveBeenCalledWith({
      purpose: 'release',
      selectedOutcome: 'ship',
      alternatives: ['wait', 'cancel'],
      confidence: 0.8,
    });
  });
});
