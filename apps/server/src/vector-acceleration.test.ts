import { describe, expect, it } from 'vitest';

import { embeddingDimensionsFromEnv, vectorAccelerationFromEnv } from './vector-acceleration.js';

describe('enterprise vector acceleration configuration', () => {
  it('keeps acceleration disabled by default', () => {
    expect(vectorAccelerationFromEnv({})).toBeUndefined();
    expect(embeddingDimensionsFromEnv({})).toBe(8);
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

  it('rejects unknown acceleration modes and invalid dimensions', () => {
    expect(() => vectorAccelerationFromEnv({ KOTOWARI_VECTOR_ACCELERATION: 'ivfflat' })).toThrow(
      'none',
    );
    expect(() =>
      vectorAccelerationFromEnv({
        KOTOWARI_VECTOR_ACCELERATION: 'pgvector-hnsw',
        KOTOWARI_EMBEDDING_DIMENSIONS: '0',
      }),
    ).toThrow('positive integer');
  });
});
