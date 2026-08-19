import {
  asClaimId,
  asEntityId,
  asIsoTimestamp,
  asNamespaceId,
  asPrincipalId,
  asTenantId,
  claimText,
} from '@kotowari/plugin-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createPgPoolClient,
  createPostgresCanonicalStore,
  createPostgresRetrievalProjection,
} from './public.js';

import type { PostgresRetrievalProjection, SqlClient } from './public.js';
import type {
  CanonicalStore,
  Claim,
  DomainEvent,
  EmbeddingProvider,
} from '@kotowari/plugin-sdk';

const DATABASE_URL = process.env.KOTOWARI_TEST_POSTGRES_URL;
const describeLive = DATABASE_URL === undefined ? describe.skip : describe;
const NOW = asIsoTimestamp('2026-08-19T00:00:00.000Z');
const DIMENSIONS = 8;
const LIMIT = 10;

type SqlCountRow = { count: string | number };

type CorpusItem = {
  id: string;
  tenantId: string;
  namespaceId: string;
  validFrom: string;
  validTo?: string;
  vector: readonly number[];
};

function normalize(values: readonly number[]): readonly number[] {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / magnitude);
}

function corpusVector(index: number): readonly number[] {
  return normalize(
    Array.from({ length: DIMENSIONS }, (_, dimension) => {
      const seed = (index + 1) * (dimension + 3);
      return Math.sin(seed * 0.173) + Math.cos(seed * 0.071);
    }),
  );
}

function claim(item: CorpusItem): Claim {
  return {
    tenantId: asTenantId(item.tenantId),
    namespaceId: asNamespaceId(item.namespaceId),
    principalId: asPrincipalId('principal-live-test'),
    classification: 'internal',
    visibility: 'workspace',
    policyTags: [],
    id: asClaimId(item.id),
    subject: asEntityId(`entity-${item.id}`),
    predicate: 'description',
    object: { kind: 'literal', value: `live vector ${item.id}` },
    bitemporal: {
      validFrom: asIsoTimestamp(item.validFrom),
      ...(item.validTo === undefined ? {} : { validTo: asIsoTimestamp(item.validTo) }),
      recordedAt: NOW,
      assertedAt: NOW,
    },
    confidence: 1,
    status: 'asserted',
    evidenceIds: [],
    provenance: {
      source: 'pgvector-live-test',
      actor: asPrincipalId('principal-live-test'),
      process: 'test',
      timestamp: NOW,
      parentIds: [],
    },
  };
}

function event(item: CorpusItem, sequence: number): DomainEvent {
  return {
    kind: 'claim.asserted',
    eventId: `event-${sequence}` as never,
    tenantId: asTenantId(item.tenantId),
    claimId: asClaimId(item.id),
    provenance: {
      source: 'pgvector-live-test',
      actor: asPrincipalId('principal-live-test'),
      process: 'claim.asserted',
      timestamp: NOW,
      parentIds: [],
    },
    occurredAt: asIsoTimestamp(
      new Date(Date.parse('2026-08-19T00:00:00.000Z') + sequence * 1000).toISOString(),
    ),
  };
}

function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    dot += l * r;
    leftNorm += l * l;
    rightNorm += r * r;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function exactTopK(
  corpus: readonly CorpusItem[],
  queryVector: readonly number[],
  tenantId: string,
  namespaceId: string,
  validAt: string,
): readonly string[] {
  return corpus
    .filter(
      (item) =>
        item.tenantId === tenantId &&
        item.namespaceId === namespaceId &&
        item.validFrom <= validAt &&
        (item.validTo === undefined || validAt < item.validTo),
    )
    .map((item) => ({ id: item.id, score: cosine(queryVector, item.vector) }))
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, LIMIT)
    .map((item) => item.id);
}

function recallAtK(expected: readonly string[], actual: readonly string[]): number {
  if (expected.length === 0) return 1;
  const actualSet = new Set(actual);
  return expected.filter((id) => actualSet.has(id)).length / expected.length;
}

describeLive('Postgres pgvector HNSW live validation', () => {
  let sql: SqlClient;
  let store: CanonicalStore;
  let projection: PostgresRetrievalProjection;
  const vectorsByText = new Map<string, readonly number[]>();
  const embeddings: EmbeddingProvider = {
    id: 'pgvector-live-test',
    async embed({ texts }) {
      return {
        vectors: texts.map((text) => {
          const vector = vectorsByText.get(text);
          if (vector === undefined) throw new Error(`missing test vector for ${text}`);
          return vector;
        }),
      };
    },
  };

  const corpus: CorpusItem[] = Array.from({ length: 320 }, (_, index) => ({
    id: `claim-${String(index).padStart(4, '0')}`,
    tenantId: index % 5 === 0 ? 'tenant-other' : 'tenant-live',
    namespaceId: index % 3 === 0 ? 'namespace-b' : 'namespace-a',
    validFrom: index % 7 === 0 ? '2027-01-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
    ...(index % 11 === 0 ? { validTo: '2026-06-01T00:00:00.000Z' } : {}),
    vector: corpusVector(index),
  }));

  beforeAll(async () => {
    if (DATABASE_URL === undefined) throw new Error('KOTOWARI_TEST_POSTGRES_URL is required');
    sql = createPgPoolClient(DATABASE_URL);
    store = createPostgresCanonicalStore(sql);
    projection = createPostgresRetrievalProjection({
      sql,
      store,
      embeddings,
      vectorAcceleration: {
        kind: 'pgvector-hnsw',
        dimensions: DIMENSIONS,
        efSearch: 80,
        m: 16,
        efConstruction: 64,
      },
    });

    await sql.exec(`
      DROP TABLE IF EXISTS retrieval_projection_events;
      DROP TABLE IF EXISTS retrieval_projection_meta;
      DROP TABLE IF EXISTS retrieval_projection;
      DROP TABLE IF EXISTS claim_fts;
      DROP TABLE IF EXISTS embeddings;
      DROP TABLE IF EXISTS outbox;
      DROP TABLE IF EXISTS events;
      DROP TABLE IF EXISTS record_history;
      DROP TABLE IF EXISTS records;
    `);

    for (const [sequence, item] of corpus.entries()) {
      const value = claim(item);
      vectorsByText.set(claimText(value), item.vector);
      await store.assertClaim(value);
      await store.appendEvent(event(item, sequence + 1));
    }
    await projection.rebuild();
  }, 120_000);

  afterAll(async () => {
    if (DATABASE_URL === undefined) return;
    await sql.exec(`
      DROP TABLE IF EXISTS retrieval_projection_events;
      DROP TABLE IF EXISTS retrieval_projection_meta;
      DROP TABLE IF EXISTS retrieval_projection;
      DROP TABLE IF EXISTS claim_fts;
      DROP TABLE IF EXISTS embeddings;
      DROP TABLE IF EXISTS outbox;
      DROP TABLE IF EXISTS events;
      DROP TABLE IF EXISTS record_history;
      DROP TABLE IF EXISTS records;
    `);
  });

  it('returns high-recall top-k results under tenant, namespace, and temporal filters', async () => {
    const validAt = '2026-08-19T00:00:00.000Z';
    const queries = [7, 31, 77, 141, 219].map(corpusVector);
    const recalls: number[] = [];

    for (const queryVector of queries) {
      const expected = exactTopK(corpus, queryVector, 'tenant-live', 'namespace-a', validAt);
      const actual = await projection.search({
        tenantId: asTenantId('tenant-live'),
        namespaceId: asNamespaceId('namespace-a'),
        strategy: 'vector',
        query: 'benchmark',
        queryVector,
        temporal: { validAt: asIsoTimestamp(validAt) },
        limit: LIMIT,
      });
      recalls.push(recallAtK(expected, actual.map((candidate) => candidate.claimId)));
    }

    const meanRecall = recalls.reduce((sum, value) => sum + value, 0) / recalls.length;
    expect(meanRecall).toBeGreaterThanOrEqual(0.95);
    expect(Math.min(...recalls)).toBeGreaterThanOrEqual(0.9);
  });

  it('marks a missing HNSW index stale and recovers after rebuild', async () => {
    await sql.exec('DROP INDEX CONCURRENTLY IF EXISTS retrieval_projection_vector_hnsw');
    const missing = await projection.status();
    expect(missing.stale).toBe(true);
    expect(missing.vectorIndex?.present).toBe(false);

    await projection.rebuildVectorIndex();
    const recovered = await projection.status();
    expect(recovered.stale).toBe(false);
    expect(recovered.vectorIndex?.present).toBe(true);
  });

  it('keeps the acceleration column populated for every projected claim', async () => {
    const rows = await sql.query<SqlCountRow>(
      'SELECT COUNT(*) AS count FROM retrieval_projection WHERE vector_embedding IS NULL',
    );
    expect(Number(rows[0]?.count ?? -1)).toBe(0);
  });
});
