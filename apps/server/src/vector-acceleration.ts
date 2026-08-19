import type { VectorRolloutPolicy } from './projection-serving.js';
import type { PgvectorHnswOptions } from '@kotowari/adapter-postgres';

const DEFAULT_EMBEDDING_DIMENSIONS = 8;

function positiveIntEnv(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.length === 0) {
    return fallback;
  }
  const value = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function embeddingDimensionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): number {
  return positiveIntEnv(env, 'KOTOWARI_EMBEDDING_DIMENSIONS', DEFAULT_EMBEDDING_DIMENSIONS);
}

export function vectorAccelerationFromEnv(
  env: Record<string, string | undefined> = process.env,
): PgvectorHnswOptions | undefined {
  const mode = env['KOTOWARI_VECTOR_ACCELERATION'];
  if (mode === undefined || mode.length === 0 || mode === 'none') {
    return undefined;
  }
  if (mode !== 'pgvector-hnsw') {
    throw new Error(
      `KOTOWARI_VECTOR_ACCELERATION must be "none" or "pgvector-hnsw", received ${mode}`,
    );
  }
  return {
    kind: 'pgvector-hnsw',
    dimensions: embeddingDimensionsFromEnv(env),
    efSearch: positiveIntEnv(env, 'KOTOWARI_HNSW_EF_SEARCH', 100),
    m: positiveIntEnv(env, 'KOTOWARI_HNSW_M', 16),
    efConstruction: positiveIntEnv(env, 'KOTOWARI_HNSW_EF_CONSTRUCTION', 64),
  };
}

export function vectorRolloutFromEnv(
  env: Record<string, string | undefined> = process.env,
): VectorRolloutPolicy {
  const mode = env['KOTOWARI_VECTOR_ROLLOUT_MODE'] ?? 'enabled';
  if (!['disabled', 'shadow', 'canary', 'enabled'].includes(mode)) {
    throw new Error(
      'KOTOWARI_VECTOR_ROLLOUT_MODE must be "disabled", "shadow", "canary", or "enabled"',
    );
  }
  if (mode !== 'canary') {
    return { mode: mode as VectorRolloutPolicy['mode'] };
  }
  const canaryPercent = positiveIntEnv(env, 'KOTOWARI_VECTOR_CANARY_PERCENT', 5);
  if (canaryPercent > 100) {
    throw new Error('KOTOWARI_VECTOR_CANARY_PERCENT must be at most 100');
  }
  return { mode: 'canary', canaryPercent };
}
