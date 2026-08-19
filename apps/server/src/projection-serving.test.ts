import { describe, expect, it } from 'vitest';

import { createProjectionServingGate } from './projection-serving.js';

import type { PostgresRetrievalProjection } from '@kotowari/adapter-postgres';
import type { CanonicalStore, EmbeddingProvider } from '@kotowari/plugin-sdk';

function projection(input: {
  stale: boolean;
  pendingEvents: number;
  failSearch?: boolean;
  vectorClaimId?: string;
}): PostgresRetrievalProjection {
  return {
    id: 'postgres-retrieval-v1',
    rebuild: async () => {},
    rebuildVectorIndex: async () => {},
    sync: async () => {},
    search: async (request) => {
      if (input.failSearch === true) throw new Error('projection failed');
      return [
        {
          claimId:
            request.strategy === 'vector'
              ? ((input.vectorClaimId ?? 'claim-vector') as never)
              : ('claim-1' as never),
          score: 1,
        },
      ];
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

const vectorStore = {
  searchLexical: async () => [],
  listClaims: async () => [
    {
      id: 'claim-canonical',
      tenantId: 'tenant-1',
      namespaceId: 'namespace-1',
      subject: 'entity-1',
      object: { kind: 'literal', value: 'hello' },
    },
  ],
  listEmbeddings: async () => [{ claimId: 'claim-canonical', vector: [1, 0] }],
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

const vectorRequest = {
  tenantId: 'tenant-1' as never,
  namespaceId: 'namespace-1' as never,
  strategy: 'vector' as const,
  query: 'hello',
  queryVector: [1, 0],
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
    expect(snapshot.canonicalSearches).toBe(1);
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

  it('keeps vector requests canonical when rollout is disabled', async () => {
    const gate = createProjectionServingGate({
      projection: projection({ stale: false, pendingEvents: 0 }),
      store: vectorStore,
      embeddings,
      vectorRollout: { mode: 'disabled' },
    });
    expect(await gate.candidateSource.search(vectorRequest)).toEqual([
      { claimId: 'claim-canonical', score: 1 },
    ]);
    expect(await gate.status()).toMatchObject({
      projectionSearches: 0,
      canonicalSearches: 1,
      vectorRolloutBypasses: 1,
      vectorRolloutMode: 'disabled',
    });
  });

  it('returns canonical vector results while shadowing projection candidates', async () => {
    const gate = createProjectionServingGate({
      projection: projection({
        stale: false,
        pendingEvents: 0,
        vectorClaimId: 'claim-shadow-different',
      }),
      store: vectorStore,
      embeddings,
      vectorRollout: { mode: 'shadow' },
    });
    expect(await gate.candidateSource.search(vectorRequest)).toEqual([
      { claimId: 'claim-canonical', score: 1 },
    ]);
    expect(await gate.status()).toMatchObject({
      projectionSearches: 1,
      canonicalSearches: 1,
      vectorShadowSearches: 1,
      vectorShadowMismatches: 1,
      vectorRolloutBypasses: 1,
    });
  });

  it('selects canary traffic deterministically and bypasses the rest', async () => {
    const selected = createProjectionServingGate({
      projection: projection({ stale: false, pendingEvents: 0 }),
      store: vectorStore,
      embeddings,
      vectorRollout: { mode: 'canary', canaryPercent: 100 },
    });
    expect(await selected.candidateSource.search(vectorRequest)).toEqual([
      { claimId: 'claim-vector', score: 1 },
    ]);
    expect(await selected.status()).toMatchObject({
      vectorCanarySelections: 1,
      vectorRolloutBypasses: 0,
    });

    const bypassed = createProjectionServingGate({
      projection: projection({ stale: false, pendingEvents: 0 }),
      store: vectorStore,
      embeddings,
      vectorRollout: { mode: 'canary', canaryPercent: 1 },
    });
    const first = await bypassed.candidateSource.search(vectorRequest);
    const second = await bypassed.candidateSource.search(vectorRequest);
    expect(second).toEqual(first);
    const snapshot = await bypassed.status();
    expect(snapshot.vectorCanarySelections + snapshot.vectorRolloutBypasses).toBe(2);
    expect(snapshot.vectorCanarySelections % 2).toBe(0);
    expect(snapshot.vectorRolloutBypasses % 2).toBe(0);
  });
});
