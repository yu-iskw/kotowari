import { describe, expect, it } from 'vitest';

import { createPostgresRetrievalProjection } from './retrieval-projection.js';

import type { SqlClient } from './sql-client.js';
import type { CanonicalStore, EmbeddingProvider } from '@kotowari/plugin-sdk';

type Call = {
  kind: 'exec' | 'query';
  sql: string;
  params?: readonly unknown[];
};

class RecordingSqlClient implements SqlClient {
  readonly calls: Call[] = [];

  async exec(sql: string): Promise<void> {
    this.calls.push({ kind: 'exec', sql });
  }

  async query<T extends Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<T[]> {
    this.calls.push({ kind: 'query', sql, ...(params === undefined ? {} : { params }) });
    if (sql.includes('SELECT COUNT(*) AS count')) {
      return [{ count: '0' }] as unknown as T[];
    }
    if (sql.includes('1 - (vector_embedding')) {
      return [{ claim_id: 'claim-alpha', score: 0.99 }] as unknown as T[];
    }
    if (sql.includes('FROM pg_indexes')) {
      return [{ indexname: 'retrieval_projection_vector_hnsw' }] as unknown as T[];
    }
    return [];
  }

  async withTransaction<T>(fn: (tx: SqlClient) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

const embeddings: EmbeddingProvider = {
  id: 'hnsw-test-embedding',
  async embed({ texts }) {
    return { vectors: texts.map(() => [1, 0]) };
  },
};

const emptyStore = {
  async listEvents() {
    return [];
  },
} as unknown as CanonicalStore;

function projection(sql: SqlClient) {
  return createPostgresRetrievalProjection({
    sql,
    store: emptyStore,
    embeddings,
    vectorAcceleration: {
      kind: 'pgvector-hnsw',
      dimensions: 2,
      efSearch: 80,
      m: 16,
      efConstruction: 64,
    },
  });
}

describe('Postgres retrieval projection pgvector HNSW acceleration', () => {
  it('initializes pgvector and an HNSW cosine index without changing the base vector column', async () => {
    const sql = new RecordingSqlClient();
    const subject = projection(sql);

    const status = await subject.status();

    expect(sql.calls.some((call) => call.sql.includes('CREATE EXTENSION IF NOT EXISTS vector'))).toBe(
      true,
    );
    expect(
      sql.calls.some(
        (call) =>
          call.sql.includes('USING hnsw') &&
          call.sql.includes('vector_cosine_ops') &&
          call.sql.includes('vector_embedding::vector(2)'),
      ),
    ).toBe(true);
    expect(status.vectorIndex).toEqual({
      kind: 'pgvector-hnsw',
      indexName: 'retrieval_projection_vector_hnsw',
      dimensions: 2,
      efSearch: 80,
      present: true,
    });
  });

  it('uses filtered iterative HNSW search with a request-local ef_search', async () => {
    const sql = new RecordingSqlClient();
    const subject = projection(sql);

    const candidates = await subject.search({
      tenantId: 'tenant-local' as never,
      namespaceId: 'namespace-local' as never,
      strategy: 'vector',
      query: 'alpha',
      queryVector: [1, 0],
      limit: 5,
    });

    expect(candidates).toEqual([{ claimId: 'claim-alpha', score: 0.99 }]);
    expect(sql.calls.some((call) => call.sql === 'SET LOCAL hnsw.ef_search = 80')).toBe(true);
    expect(sql.calls.some((call) => call.sql === 'SET LOCAL hnsw.iterative_scan = strict_order')).toBe(
      true,
    );
    const search = sql.calls.find((call) => call.sql.includes('1 - (vector_embedding'));
    expect(search?.sql).toContain('tenant_id = $2');
    expect(search?.sql).toContain('namespace_id = $3');
    expect(search?.sql).toContain('ORDER BY vector_embedding::vector(2) <=> $1::vector(2)');
    expect(search?.params).toEqual(['[1,0]', 'tenant-local', 'namespace-local', 5]);
  });

  it('rejects query vectors that do not match the indexed dimension', async () => {
    const sql = new RecordingSqlClient();
    const subject = projection(sql);

    await expect(
      subject.search({
        tenantId: 'tenant-local' as never,
        strategy: 'vector',
        query: 'alpha',
        queryVector: [1, 0, 0],
        limit: 5,
      }),
    ).rejects.toThrow('expected 2');
  });

  it('supports explicit concurrent index rebuilds', async () => {
    const sql = new RecordingSqlClient();
    const subject = projection(sql);
    await subject.status();
    sql.calls.length = 0;

    await subject.rebuildVectorIndex();

    expect(
      sql.calls.some(
        (call) => call.sql === 'DROP INDEX CONCURRENTLY IF EXISTS retrieval_projection_vector_hnsw',
      ),
    ).toBe(true);
    expect(sql.calls.some((call) => call.sql.includes('CREATE INDEX CONCURRENTLY IF NOT EXISTS'))).toBe(
      true,
    );
  });
});
