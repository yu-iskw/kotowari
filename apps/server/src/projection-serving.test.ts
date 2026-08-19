import { describe, expect, it } from 'vitest';

import { createProjectionServingGate } from './projection-serving.js';

import type { PostgresRetrievalProjection } from '@kotowari/adapter-postgres';
import type { CanonicalStore, EmbeddingProvider } from '@kotowari/plugin-sdk';

function projectionFixture(input: {
  stale: boolean;
  pendingEvents: number;
  failSearch?: boolean;
}): { projection: PostgresRetrievalProjection; calls: () => number } {
  let calls = 0;
  return {
    projection: {
      id: 'postgres-retrieval-v1',
      rebuild: async () => {},
      rebuildVectorIndex: async () => {},
      sync: async () => {},
      search: async () => {
        calls += 1;
        if (input.failSearch === true) throw new Error('projection failed');
        return [{ claimId: 'claim-1' as never, score: 1 }];
      },
      status: async () => ({
        projectionId: 'postgres-retrieval-v1',
        stale: input.stale,
        pendingEvents: input.pendingEvents,
      }),
    },
    calls: () => calls,
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
  it('uses canonical fallback while enabled projection is stale', async () => {
    const fixture = projectionFixture({ stale: true, pendingEvents: 2 });
    const gate = createProjectionServingGate({
      projection: fixture.projection,
      store,
      embeddings,
    });
    expect(await gate.candidateSource.search(lexicalRequest)).toEqual([]);
    const snapshot = await gate.status();
    expect(snapshot.ready).toBe(false);
    expect(snapshot.servingReady).toBe(false);
    expect(snapshot.canonicalFallbacks).toBe(1);
    expect(snapshot.lastFallbackReason).toBe('unavailable');
    expect(fixture.calls()).toBe(0);
  });

  it('uses the projection while enabled and fresh', async () => {
    const fixture = projectionFixture({ stale: false, pendingEvents: 0 });
    const gate = createProjectionServingGate({
      projection: fixture.projection,
      store,
      embeddings,
    });
    expect(await gate.candidateSource.search(lexicalRequest)).toHaveLength(1);
    const metrics = await gate.metrics();
    expect(metrics).toContain('kotowari_projection_ready 1');
    expect(metrics).toContain('kotowari_retrieval_serving_ready 1');
    expect(metrics).toContain('kotowari_projection_searches_total 1');
    expect(metrics).toContain('kotowari_projection_search_latency_ms_count 1');
  });

  it('serves canonical storage when rollout is disabled even if projection is fresh', async () => {
    const fixture = projectionFixture({ stale: false, pendingEvents: 0 });
    const gate = createProjectionServingGate({
      projection: fixture.projection,
      store,
      embeddings,
      policy: { mode: 'disabled', canaryPercent: 10, maxConsecutiveErrors: 3 },
    });
    expect(await gate.candidateSource.search(lexicalRequest)).toEqual([]);
    expect(fixture.calls()).toBe(0);
    const snapshot = await gate.status();
    expect(snapshot.servingReady).toBe(true);
    expect(snapshot.effectiveMode).toBe('disabled');
    expect(snapshot.canonicalFallbacks).toBe(0);
  });

  it('returns canonical results in shadow mode while comparing the projection', async () => {
    const fixture = projectionFixture({ stale: false, pendingEvents: 0 });
    const gate = createProjectionServingGate({
      projection: fixture.projection,
      store,
      embeddings,
      policy: { mode: 'shadow', canaryPercent: 10, maxConsecutiveErrors: 3 },
    });
    expect(await gate.candidateSource.search(lexicalRequest)).toEqual([]);
    expect(fixture.calls()).toBe(1);
    const snapshot = await gate.status();
    expect(snapshot.shadowComparisons).toBe(1);
    expect(snapshot.shadowMismatches).toBe(1);
    expect(snapshot.projectionServedSearches).toBe(0);
    expect(snapshot.canonicalFallbacks).toBe(0);
  });

  it('canaries only requests selected by the sampler', async () => {
    const selected = projectionFixture({ stale: false, pendingEvents: 0 });
    const selectedGate = createProjectionServingGate({
      projection: selected.projection,
      store,
      embeddings,
      policy: { mode: 'canary', canaryPercent: 10, maxConsecutiveErrors: 3 },
      sample: () => 5,
    });
    expect(await selectedGate.candidateSource.search(lexicalRequest)).toHaveLength(1);
    expect(selected.calls()).toBe(1);

    const unselected = projectionFixture({ stale: false, pendingEvents: 0 });
    const unselectedGate = createProjectionServingGate({
      projection: unselected.projection,
      store,
      embeddings,
      policy: { mode: 'canary', canaryPercent: 10, maxConsecutiveErrors: 3 },
      sample: () => 50,
    });
    expect(await unselectedGate.candidateSource.search(lexicalRequest)).toEqual([]);
    expect(unselected.calls()).toBe(0);
  });

  it('automatically rolls back after consecutive projection failures and can be reset', async () => {
    const fixture = projectionFixture({ stale: false, pendingEvents: 0, failSearch: true });
    const gate = createProjectionServingGate({
      projection: fixture.projection,
      store,
      embeddings,
      policy: { mode: 'enabled', canaryPercent: 10, maxConsecutiveErrors: 2 },
    });

    expect(await gate.candidateSource.search(lexicalRequest)).toEqual([]);
    expect(await gate.candidateSource.search(lexicalRequest)).toEqual([]);
    let snapshot = await gate.status();
    expect(snapshot.rollbackActive).toBe(true);
    expect(snapshot.effectiveMode).toBe('disabled');
    expect(snapshot.rollbackReason).toBe('consecutive-errors');
    expect(snapshot.projectionErrors).toBe(2);

    expect(await gate.candidateSource.search(lexicalRequest)).toEqual([]);
    expect(fixture.calls()).toBe(2);
    snapshot = await gate.status();
    expect(snapshot.lastFallbackReason).toBe('rollback');
    expect(snapshot.canonicalFallbacks).toBe(3);

    gate.resetRollback();
    snapshot = await gate.status();
    expect(snapshot.rollbackActive).toBe(false);
    expect(snapshot.effectiveMode).toBe('enabled');
  });

  it('does not make a single projection error permanently suppress retries', async () => {
    const fixture = projectionFixture({ stale: false, pendingEvents: 0, failSearch: true });
    const gate = createProjectionServingGate({
      projection: fixture.projection,
      store,
      embeddings,
      policy: { mode: 'enabled', canaryPercent: 10, maxConsecutiveErrors: 3 },
    });
    expect(await gate.candidateSource.search(lexicalRequest)).toEqual([]);
    expect(await gate.candidateSource.search(lexicalRequest)).toEqual([]);
    expect(fixture.calls()).toBe(2);
    const snapshot = await gate.status();
    expect(snapshot.rollbackActive).toBe(false);
    expect(snapshot.projectionErrors).toBe(2);
  });
});
