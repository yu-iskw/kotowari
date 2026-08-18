import {
  createPgPoolClient,
  createPostgresCanonicalStore,
  createPostgresRetrievalProjection,
} from '@kotowari/adapter-postgres';
import { createFakeEmbeddingProvider } from '@kotowari/model-fake';

import type {
  PostgresRetrievalProjection,
  RetrievalProjectionStatus,
} from '@kotowari/adapter-postgres';

export type RetrievalProjectionMaintenance = Pick<
  PostgresRetrievalProjection,
  'rebuild' | 'status' | 'sync'
>;

export type { RetrievalProjectionStatus };

export function createComposeRetrievalProjectionFromEnv(
  env: Record<string, string | undefined> = process.env,
): RetrievalProjectionMaintenance {
  const databaseUrl = env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error('DATABASE_URL is required for retrieval projection maintenance');
  }
  const sql = createPgPoolClient(databaseUrl);
  const store = createPostgresCanonicalStore(sql);
  return createPostgresRetrievalProjection({
    sql,
    store,
    embeddings: createFakeEmbeddingProvider(),
  });
}
