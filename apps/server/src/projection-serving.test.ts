import { describe, expect, it } from 'vitest';

import { createProjectionServingGate } from './projection-serving.js';

import type { PostgresRetrievalProjection } from '@kotowari/adapter-postgres';

function projection(statuses: Array<{ stale: boolean; pendingEvents: number }>): PostgresRetrievalProjection {
  let index = 0;
  return {
    id: 'postgres-retrieval-v1',
    rebuild: async () => {},
    sync: async () => {},
    search: async () => [],
    status: async () => {
      const value = statuses[Math.min(index, statuses.length - 1)] ?? { stale: false, pendingEvents: 0 };
      index += 1;
      return {
        projectionId: 'postgres-retrieval-v1',
        stale: value.stale,
        pendingEvents: value.pendingEvents,
      };
    },
  };
}

describe('projection serving gate', () => {
  it('rejects stale projection and records canonical fallback', async () => {
    const gate = createProjectionServingGate(projection([{ stale: true, pendingEvents: 2 }]));
    expect(await gate.policy.available?.()).toBe(false);
    await gate.policy.onFallback?.({ reason: 'unavailable' });
    const snapshot = await gate.status();
    expect(snapshot.ready).toBe(false);
    expect(snapshot.canonicalFallbacks).toBe(1);
  });

  it('records successful projection selection', async () => {
    const gate = createProjectionServingGate(projection([{ stale: false, pendingEvents: 0 }]));
    expect(await gate.policy.available?.()).toBe(true);
    await gate.policy.onSelected?.();
    const metrics = await gate.metrics();
    expect(metrics).toContain('kotowari_projection_ready 1');
    expect(metrics).toContain('kotowari_projection_selections_total 1');
  });

  it('records a serving failure and becomes unhealthy', async () => {
    const gate = createProjectionServingGate(projection([{ stale: false, pendingEvents: 0 }]));
    await gate.policy.onFallback?.({ reason: 'error', error: new Error('projection failed') });
    const snapshot = await gate.status();
    expect(snapshot.healthy).toBe(false);
    expect(snapshot.projectionErrors).toBe(1);
    expect(snapshot.lastError).toBe('projection failed');
  });
});
