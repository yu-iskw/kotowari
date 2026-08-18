import { describe, expect, it } from 'vitest';

import { createProjectionServingGate } from './projection-serving.js';

import type { PostgresRetrievalProjection } from '@kotowari/adapter-postgres';
import type { CanonicalStore, EmbeddingProvider } from '@kotowari/plugin-sdk';

function projection(input: {
  stale: boolean;
  pendingEvents: number;
  failSearch?: boolean;
}): PostgresRetrievalProjection {
  return {
    id: 'postgres-retrieval-v1',
    rebuild: async () => {},
    rebuildVectorIndex: async () => {},
    sync: async () => {},
    search: async () => {
      if (input.failSearch === true) throw new Error('projection failed');
      return [{ claimId: 'claim-1' as never, score: 1 }];
    },
    status: async () => ({
      projectionId: 'postgres-retrieval-v1',
      stale: input.stale,
      pendingEvents: input.pendingEvents,
    }),
  };
}

const store = {
  searchLexical: async () => [],
  listClaims: async () => [],
  listEmbeddings: async () => [],
} as unknown as CanonicalStore;

const embeddings = {
  id: 'test-embeddings',
  embed: async ({ texts }: { texts: readonly string[] }) => ({
    vectors: texts.map(() => [1, 0]),
  }),
} as EmbeddingProvider;

const lexicalRequest = {
  tenantId: 'tenant-1' as never,
  namespaceId: 'namespace-1' as never,
  strategy: 'lexical' as const,
  query: 'hello',
  limit: 10,
};

describe('projection serving gate', () => {
  it('uses canonical fallback while projection is stale', async () => {
    const gate = createProjectionServingGate({
      projection: projection({ stale: true, pendingEvents: 2 }),
      store,
      embeddings,
    });
    expect(await gate.candidateSource.search(lexicalRequest)).toEqual([]);
    const snapshot = await gate.status();
    expect(snapshot.ready).toBe(false);
    expect(snapshot.canonicalFallbacks).toBe(1);
    expect(snapshot.lastFallbackReason).toBe('unavailable');
  });

  it('uses the projection while it is fresh', async () => {
    const gate = createProjectionServingGate({
      projection: projection({ stale: false, pendingEvents: 0 }),
      store,
      embeddings,
    });
    expect(await gate.candidateSource.search(lexicalRequest)).toHaveLength(1);
    const metrics = await gate.metrics();
    expect(metrics).toContain('kotowari_projection_ready 1');
    expect(metrics).toContain('kotowari_projection_searches_total 1');
  });

  it('falls back canonically when projection search fails', async () => {
    const gate = createProjectionServingGate({
      projection: projection({ stale: false, pendingEvents: 0, failSearch: true }),
      store,
      embeddings,
    });
    expect(await gate.candidateSource.search(lexicalRequest)).toEqual([]);
    const snapshot = await gate.status();
    expect(snapshot.healthy).toBe(false);
    expect(snapshot.projectionErrors).toBe(1);
    expect(snapshot.canonicalFallbacks).toBe(1);
    expect(snapshot.lastError).toBe('projection failed');
  });
});
