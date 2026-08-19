import { describe, expect, it } from 'vitest';

import {
  embeddingDimensionsFromEnv,
  vectorAccelerationFromEnv,
  vectorRolloutFromEnv,
} from './vector-acceleration.js';

describe('enterprise vector acceleration configuration', () => {
  it('keeps acceleration disabled and rollout enabled by default', () => {
    expect(vectorAccelerationFromEnv({})).toBeUndefined();
    expect(embeddingDimensionsFromEnv({})).toBe(8);
    expect(vectorRolloutFromEnv({})).toEqual({ mode: 'enabled' });
  });

  it('builds pgvector HNSW options from explicit enterprise configuration', () => {
    expect(
      vectorAccelerationFromEnv({
        KOTOWARI_VECTOR_ACCELERATION: 'pgvector-hnsw',
        KOTOWARI_EMBEDDING_DIMENSIONS: '768',
        KOTOWARI_HNSW_EF_SEARCH: '120',
        KOTOWARI_HNSW_M: '24',
        KOTOWARI_HNSW_EF_CONSTRUCTION: '96',
      }),
    ).toEqual({
      kind: 'pgvector-hnsw',
      dimensions: 768,
      efSearch: 120,
      m: 24,
      efConstruction: 96,
    });
  });

  it('parses shadow and canary rollout configuration', () => {
    expect(vectorRolloutFromEnv({ KOTOWARI_VECTOR_ROLLOUT_MODE: 'shadow' })).toEqual({
      mode: 'shadow',
    });
    expect(
      vectorRolloutFromEnv({
        KOTOWARI_VECTOR_ROLLOUT_MODE: 'canary',
        KOTOWARI_VECTOR_CANARY_PERCENT: '12',
      }),
    ).toEqual({ mode: 'canary', canaryPercent: 12 });
  });

  it('rejects unknown acceleration and rollout modes or invalid rollout percentages', () => {
    expect(() => vectorAccelerationFromEnv({ KOTOWARI_VECTOR_ACCELERATION: 'ivfflat' })).toThrow(
      'none',
    );
    expect(() =>
      vectorAccelerationFromEnv({
        KOTOWARI_VECTOR_ACCELERATION: 'pgvector-hnsw',
        KOTOWARI_EMBEDDING_DIMENSIONS: '0',
      }),
    ).toThrow('positive integer');
    expect(() => vectorRolloutFromEnv({ KOTOWARI_VECTOR_ROLLOUT_MODE: 'random' })).toThrow(
      'KOTOWARI_VECTOR_ROLLOUT_MODE',
    );
    expect(() =>
      vectorRolloutFromEnv({
        KOTOWARI_VECTOR_ROLLOUT_MODE: 'canary',
        KOTOWARI_VECTOR_CANARY_PERCENT: '101',
      }),
    ).toThrow('at most 100');
  });
});
