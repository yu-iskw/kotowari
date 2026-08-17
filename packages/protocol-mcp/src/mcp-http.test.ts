import { describe, expect, it } from 'vitest';

import {
  handleMcpHttp,
  MCP_ERROR_HEADER_MISMATCH,
  MCP_PROTOCOL_VERSION,
  PROFILE_TOOLS,
  spyApplicationCommandName,
} from './public.js';

import type { KotowariApp } from '@kotowari/application';

function fakeApp(): KotowariApp {
  return {
    ingestDocuments: async () => ({
      evidenceIds: ['e-inline'],
      claimIds: ['c-inline'],
      entityIds: [],
    }),
    ingestPath: async (target: string) => ({
      evidenceIds: [`path:${target}`],
      claimIds: [],
      entityIds: [],
    }),
    searchKnowledge: async () => ({
      hits: [],
      omitted: [],
      plan: { candidates: [], rerank: 'none', budget: 20, explain: true },
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
    listPolicies: async () => [{ id: 'p1', name: 'default' }] as never,
    health: () => ({ ok: true, profile: 'standalone' }),
    currentPrincipal: async () => ({}) as never,
  };
}

describe('ADR-0004 MCP v2 headers', () => {
  it('ADR-0004 rejects header/body mismatch with -32020', async () => {
    const result = await handleMcpHttp({
      profile: 'retrieve',
      headers: {
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'search_knowledge',
      },
      body: {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'search_memory', arguments: {} },
      },
      app: fakeApp(),
    });
    expect(result.status).toBe(400);
    const error = (result.json as { error: { code: number } }).error;
    expect(error.code).toBe(MCP_ERROR_HEADER_MISMATCH);
  });

  it('S12 retrieve profile does not list admin tools', () => {
    expect(PROFILE_TOOLS.retrieve).not.toContain('list_policies');
    expect(PROFILE_TOOLS.retrieve).not.toContain('ingest_path');
    expect(PROFILE_TOOLS.ingestion).toContain('ingest_path');
    expect(PROFILE_TOOLS.admin).toContain('list_policies');
    expect(PROFILE_TOOLS.retrieve).not.toEqual(PROFILE_TOOLS.admin);
  });

  it('tools invoke application commands, not kernel internals', () => {
    expect(spyApplicationCommandName('search_knowledge')).toBe('searchKnowledge');
    expect(spyApplicationCommandName('record_decision')).toBe('recordDecision');
  });
});

describe('S2 MCP ingest and S12 admin tools', () => {
  it('S2 ingest_path with text calls ingestDocuments', async () => {
    const result = await handleMcpHttp({
      profile: 'ingestion',
      headers: {
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'ingest_path',
      },
      body: {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'ingest_path',
          arguments: { path: 'note.md', text: 'Alice Chen is CEO.', mimeType: 'text/markdown' },
        },
      },
      app: fakeApp(),
    });
    expect(result.status).toBe(200);
    const json = result.json as { result: { evidenceIds: string[] } };
    expect(json.result.evidenceIds).toEqual(['e-inline']);
  });

  it('S2 ingest_path with filesystem path calls ingestPath', async () => {
    const result = await handleMcpHttp({
      profile: 'ingestion',
      headers: {
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'ingest_path',
      },
      body: {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'ingest_path', arguments: { path: '/tmp/corpus' } },
      },
      app: fakeApp(),
    });
    expect(result.status).toBe(200);
    const json = result.json as { result: { evidenceIds: string[] } };
    expect(json.result.evidenceIds).toEqual(['path:/tmp/corpus']);
  });

  it('S12 list_policies is an application command', async () => {
    expect(spyApplicationCommandName('list_policies')).toBe('listPolicies');
    const result = await handleMcpHttp({
      profile: 'admin',
      headers: {
        'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
        'Mcp-Method': 'tools/call',
        'Mcp-Name': 'list_policies',
      },
      body: {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'list_policies', arguments: {} },
      },
      app: fakeApp(),
    });
    expect(result.status).toBe(200);
    const json = result.json as { result: { policies: { id: string }[] } };
    expect(json.result.policies[0]?.id).toBe('p1');
  });
});
