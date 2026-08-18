import { describe, expect, it } from 'vitest';

import { createProjectionOperations } from './projection-operations.js';

import type { RetrievalProjectionMaintenance, RetrievalProjectionStatus } from '@kotowari/server';

function maintenance(input: {
  status: () => RetrievalProjectionStatus;
  sync?: () => Promise<void>;
  rebuild?: () => Promise<void>;
}): RetrievalProjectionMaintenance {
  return {
    status: async () => input.status(),
    sync: input.sync ?? (async () => undefined),
    rebuild: input.rebuild ?? (async () => undefined),
  };
}

describe('retrieval projection operations', () => {
  it('reports stale lag and fails readiness while events are pending', async () => {
    const projection = maintenance({
      status: () => ({
        projectionId: 'postgres-retrieval-v1',
        latestRelevantEventAt: '2026-08-18T00:00:00.000Z',
        pendingEvents: 2,
        stale: true,
      }),
    });
    const operations = createProjectionOperations(projection, {
      maxLagMs: 5_000,
      now: () => new Date('2026-08-18T00:00:10.000Z'),
    });

    expect(await operations.status()).toMatchObject({
      ready: false,
      healthy: false,
      lagMs: 10_000,
      pendingEvents: 2,
    });
  });

  it('records successful synchronization and returns ready health', async () => {
    let stale = true;
    const projection = maintenance({
      status: () => ({
        projectionId: 'postgres-retrieval-v1',
        pendingEvents: stale ? 1 : 0,
        stale,
      }),
      sync: async () => {
        stale = false;
      },
    });
    const operations = createProjectionOperations(projection, {
      now: () => new Date('2026-08-18T01:02:03.000Z'),
    });

    expect(await operations.syncOnce()).toMatchObject({
      ready: true,
      healthy: true,
      lastAttemptAt: '2026-08-18T01:02:03.000Z',
      lastSuccessfulSyncAt: '2026-08-18T01:02:03.000Z',
    });
  });

  it('retries after a sync error and shuts down through AbortSignal', async () => {
    const abort = new AbortController();
    let attempts = 0;
    const projection = maintenance({
      status: () => ({
        projectionId: 'postgres-retrieval-v1',
        pendingEvents: 0,
        stale: false,
      }),
      sync: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('temporary database error');
        abort.abort();
      },
    });
    const operations = createProjectionOperations(projection, {
      syncIntervalMs: 1,
      retryIntervalMs: 1,
    });

    await operations.run({ signal: abort.signal });
    expect(attempts).toBe(2);
    expect(await operations.status()).toMatchObject({ healthy: true, ready: true });
  });

  it('uses the same operational checkpoint for manual rebuilds', async () => {
    let rebuilds = 0;
    const projection = maintenance({
      status: () => ({
        projectionId: 'postgres-retrieval-v1',
        pendingEvents: 0,
        stale: false,
      }),
      rebuild: async () => {
        rebuilds += 1;
      },
    });
    const operations = createProjectionOperations(projection, {
      now: () => new Date('2026-08-18T04:05:06.000Z'),
    });

    expect(await operations.rebuild()).toMatchObject({
      ready: true,
      lastSuccessfulSyncAt: '2026-08-18T04:05:06.000Z',
    });
    expect(rebuilds).toBe(1);
  });
});
