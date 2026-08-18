import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { handleMcpRpc, handleMcpStdio, PROFILE_TOOLS, TOOL_SCHEMAS } from './public.js';

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
      receipt: {} as never,
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
    getEvidence: async () => undefined,
    getEvidenceContent: async () => undefined,
    reextractFromEvidence: async () => ({ evidenceIds: [], claimIds: [], entityIds: [] }),
    processQueuedJobs: async () => 0,
    runAsRequest: async <T>(_headers: Record<string, string | undefined>, fn: () => Promise<T>) =>
      fn(),
  };
}

describe('S1 S4 S12 MCP stdio', () => {
  it('S12 retrieve tools/list excludes admin tools and includes schemas', async () => {
    const rpc = await handleMcpRpc({
      profile: 'retrieve',
      app: fakeApp(),
      body: { jsonrpc: '2.0', id: 1, method: 'tools/list' },
    });
    const tools = (rpc.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
    const names = tools.map((tool) => tool.name);
    expect(names).toEqual([...PROFILE_TOOLS.retrieve]);
    expect(names).not.toContain('list_policies');
    expect(names).not.toContain('ingest_path');
    const decision = tools.find((tool) => tool.name === 'record_decision');
    expect(decision?.inputSchema).toEqual(TOOL_SCHEMAS.record_decision?.inputSchema);
    expect(
      (decision?.inputSchema as { required: string[] }).required.includes('selectedOutcome'),
    ).toBe(true);
  });

  it('S4 stdio JSON-RPC lists retrieve tools without HTTP headers', async () => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const chunks: Buffer[] = [];
    stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    const running = handleMcpStdio({
      profile: 'retrieve',
      app: fakeApp(),
      stdin,
      stdout,
    });
    stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/list' })}\n`);
    stdin.end();
    await running;
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      result: { tools: { name: string }[] };
    };
    expect(payload.result.tools.map((tool) => tool.name)).toEqual([
      'search_knowledge',
      'search_memory',
      'record_decision',
    ]);
  });
});
