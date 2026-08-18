import { describe, expect, it } from 'vitest';

import { createMcpHttpHandler, protectedResourceMetadata } from './public.js';

import type { KotowariApp } from '@kotowari/application';

function fakeApp(): KotowariApp {
  return {
    ingestDocuments: async () => ({ evidenceIds: [], claimIds: [], entityIds: [] }),
    searchKnowledge: async () => ({
      hits: [],
      omitted: [],
      plan: {} as never,
      receipt: {} as never,
    }),
    buildContext: async () => ({}) as never,
    recordDecision: async () => ({}) as never,
    getDecision: async () => undefined,
    listDecisions: async () => [],
    recordMemory: async () => ({}) as never,
    searchMemory: async () => [],
    putPolicy: async () => ({}) as never,
    whatIfPolicy: async () => [],
    resolveConflict: async () => ({}) as never,
    exportProvO: async () => undefined,
    listPredicates: async () => [],
    listPolicies: async () => [],
    getEvidence: async () => undefined,
    getEvidenceContent: async () => undefined,
    reextractFromEvidence: async () => ({ evidenceIds: [], claimIds: [], entityIds: [] }),
    processQueuedJobs: async () => 0,
    health: () => ({ ok: true, profile: 'test' }),
    currentPrincipal: async () => ({}) as never,
    runAsRequest: async <T>(_headers: Record<string, string | undefined>, fn: () => Promise<T>) =>
      fn(),
  };
}

describe('MCP enterprise HTTP authorization', () => {
  it('publishes profile-specific Protected Resource Metadata', () => {
    const metadata = protectedResourceMetadata({
      profile: 'retrieve',
      resourceServerUrl: new URL('https://kotowari.example.com/mcp/retrieve'),
      authorizationServers: ['https://id.example.com/'],
    });
    expect(metadata).toMatchObject({
      resource: 'https://kotowari.example.com/mcp/retrieve',
      authorization_servers: ['https://id.example.com/'],
      scopes_supported: ['kotowari.retrieve'],
    });
  });

  it('fails closed before MCP dispatch when a Bearer token is absent', async () => {
    const handler = createMcpHttpHandler({
      profile: 'retrieve',
      app: fakeApp(),
      authorization: {
        resourceServerUrl: new URL('https://kotowari.example.com/mcp/retrieve'),
        authorizationServers: ['https://id.example.com/'],
        verifier: {
          async verifyAccessToken(token) {
            return {
              token,
              clientId: 'test-client',
              scopes: ['kotowari.retrieve'],
              expiresAt: Math.floor(Date.now() / 1000) + 60,
            };
          },
        },
      },
    });
    try {
      const response = await handler.fetch(
        new Request('https://kotowari.example.com/mcp/retrieve', { method: 'POST' }),
      );
      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toContain('resource_metadata');
    } finally {
      await handler.close();
    }
  });
});
