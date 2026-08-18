import {
  createPgPoolClient,
  createPostgresCanonicalStore,
  createPostgresRetrievalProjection,
} from '@kotowari/adapter-postgres';
import { createFakeEmbeddingProvider } from '@kotowari/model-fake';

import { embeddingDimensionsFromEnv, vectorAccelerationFromEnv } from './vector-acceleration.js';

import type {
  PostgresRetrievalProjection,
  RetrievalProjectionStatus,
} from '@kotowari/adapter-postgres';

export type RetrievalProjectionMaintenance = Pick<
  PostgresRetrievalProjection,
  'rebuild' | 'rebuildVectorIndex' | 'status' | 'sync'
>;

export type { RetrievalProjectionStatus };

export function createComposeRetrievalProjectionRuntimeFromEnv(
  env: Record<string, string | undefined> = process.env,
): PostgresRetrievalProjection {
  const databaseUrl = env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for retrieval projection maintenance');
  }
  const sql = createPgPoolClient(databaseUrl);
  const store = createPostgresCanonicalStore(sql);
  const vectorAcceleration = vectorAccelerationFromEnv(env);
  return createPostgresRetrievalProjection({
    sql,
    store,
    embeddings: createFakeEmbeddingProvider(embeddingDimensionsFromEnv(env)),
    ...(vectorAcceleration === undefined ? {} : { vectorAcceleration }),
  });
}

export function createComposeRetrievalProjectionFromEnv(
  env: Record<string, string | undefined> = process.env,
): RetrievalProjectionMaintenance {
  return createComposeRetrievalProjectionRuntimeFromEnv(env);
}
