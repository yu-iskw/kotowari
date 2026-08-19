import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  createPgPoolClient,
  createPostgresCanonicalStore,
  createPostgresRetrievalProjection,
} from '@kotowari/adapter-postgres';
import {
  asClaimId,
  asEntityId,
  asEventId,
  asIsoTimestamp,
  asNamespaceId,
  asPrincipalId,
  asTenantId,
  claimText,
} from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { createProjectionServingGate } from './projection-serving.js';

import type { PostgresRetrievalProjection, SqlClient } from '@kotowari/adapter-postgres';
import type {
  CanonicalStore,
  Claim,
  DomainEvent,
  EmbeddingProvider,
  RetrievalCandidateRequest,
} from '@kotowari/plugin-sdk';

const DATABASE_URL = process.env.KOTOWARI_TEST_POSTGRES_URL;
const OUTPUT_PATH = process.env.KOTOWARI_BENCHMARK_OUTPUT;
const describeLive = DATABASE_URL === undefined ? describe.skip : describe;
const NOW = asIsoTimestamp('2026-08-19T00:00:00.000Z');
const VALID_AT = asIsoTimestamp('2026-08-19T00:00:00.000Z');
const DIMENSIONS = 24;
const LIMIT = 10;
const CORPUS_SIZES = [400, 1200, 2400] as const;
const QUERY_INDEXES = [5, 29, 83, 157, 263, 389, 521, 701, 907, 1103, 1531, 2017] as const;

const TABLE_RESET_SQL = `
  DROP TABLE IF EXISTS retrieval_projection_events;
  DROP TABLE IF EXISTS retrieval_projection_meta;
  DROP TABLE IF EXISTS retrieval_projection;
  DROP TABLE IF EXISTS claim_fts;
  DROP TABLE IF EXISTS embeddings;
  DROP TABLE IF EXISTS outbox;
  DROP TABLE IF EXISTS events;
  DROP TABLE IF EXISTS record_history;
  DROP TABLE IF EXISTS records;
`;

type CorpusItem = {
  id: string;
  tenantId: string;
  namespaceId: string;
  validFrom: string;
  validTo?: string;
  vector: readonly number[];
};

type Scenario = {
  name: 'broad' | 'medium' | 'narrow';
  namespaceId?: string;
};

type LatencySummary = {
  p50Ms: number;
  p95Ms: number;
  meanMs: number;
};

type ScenarioResult = {
  name: Scenario['name'];
  selectivity: number;
  meanRecallAt10: number;
  minimumRecallAt10: number;
  latency: LatencySummary;
};

type CorpusResult = {
  corpusSize: number;
  fullProjectionRebuildMs: number;
  vectorIndexRebuildMs: number;
  scenarios: readonly ScenarioResult[];
  servingGate: {
    healthyFallbackRate: number;
    missingIndexFallbackRate: number;
    healthyLatency: LatencySummary;
    canonicalFallbackLatency: LatencySummary;
    recoveryRebuildMs: number;
  };
};

function normalize(values: readonly number[]): readonly number[] {
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / magnitude);
}

function corpusVector(index: number): readonly number[] {
  return normalize(
    Array.from({ length: DIMENSIONS }, (_, dimension) => {
      const seed = (index + 1) * (dimension + 5);
      return Math.sin(seed * 0.137) + Math.cos(seed * 0.053) + Math.sin(seed * 0.019) * 0.25;
    }),
  );
}

function namespaceFor(index: number): string {
  if (index % 10 === 0) return 'namespace-rare';
  if (index % 3 === 0) return 'namespace-b';
  return 'namespace-a';
}

function corpus(size: number): readonly CorpusItem[] {
  return Array.from({ length: size }, (_, index) => ({
    id: `benchmark-claim-${String(index).padStart(5, '0')}`,
    tenantId: index % 7 === 0 ? 'tenant-other' : 'tenant-benchmark',
    namespaceId: namespaceFor(index),
    validFrom: index % 13 === 0 ? '2027-01-01T00:00:00.000Z' : '2026-01-01T00:00:00.000Z',
    ...(index % 17 === 0 ? { validTo: '2026-06-01T00:00:00.000Z' } : {}),
    vector: corpusVector(index),
  }));
}

function claim(item: CorpusItem): Claim {
  return {
    tenantId: asTenantId(item.tenantId),
    namespaceId: asNamespaceId(item.namespaceId),
    principalId: asPrincipalId('principal-pgvector-benchmark'),
    classification: 'internal',
    visibility: 'workspace',
    policyTags: [],
    id: asClaimId(item.id),
    subject: asEntityId(`entity-${item.id}`),
    predicate: 'description',
    object: { kind: 'literal', value: `benchmark vector ${item.id}` },
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
      source: 'pgvector-benchmark',
      actor: asPrincipalId('principal-pgvector-benchmark'),
      process: 'benchmark',
      timestamp: NOW,
      parentIds: [],
    },
  };
}

function event(item: CorpusItem, sequence: number): DomainEvent {
  return {
    kind: 'claim.asserted',
    eventId: asEventId(`benchmark-event-${sequence}`),
    tenantId: asTenantId(item.tenantId),
    claimId: asClaimId(item.id),
    provenance: {
      source: 'pgvector-benchmark',
      actor: asPrincipalId('principal-pgvector-benchmark'),
      process: 'claim.asserted',
      timestamp: NOW,
      parentIds: [],
    },
    occurredAt: asIsoTimestamp(
      new Date(Date.parse('2026-08-19T00:00:00.000Z') + sequence * 10).toISOString(),
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

function matchesScenario(item: CorpusItem, scenario: Scenario): boolean {
  return (
    item.tenantId === 'tenant-benchmark' &&
    (scenario.namespaceId === undefined || item.namespaceId === scenario.namespaceId) &&
    item.validFrom <= VALID_AT &&
    (item.validTo === undefined || VALID_AT < item.validTo)
  );
}

function exactTopK(
  items: readonly CorpusItem[],
  scenario: Scenario,
  queryVector: readonly number[],
): readonly string[] {
  return items
    .filter((item) => matchesScenario(item, scenario))
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

function percentile(sorted: readonly number[], percentileValue: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index] ?? 0;
}

function summarizeLatency(samples: readonly number[]): LatencySummary {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    meanMs: samples.reduce((sum, value) => sum + value, 0) / Math.max(samples.length, 1),
  };
}

function searchRequest(
  scenario: Scenario,
  queryVector: readonly number[],
): RetrievalCandidateRequest {
  return {
    tenantId: asTenantId('tenant-benchmark'),
    ...(scenario.namespaceId === undefined
      ? {}
      : { namespaceId: asNamespaceId(scenario.namespaceId) }),
    strategy: 'vector',
    query: 'pgvector benchmark',
    queryVector,
    temporal: { validAt: VALID_AT },
    limit: LIMIT,
  };
}

async function timedSearch(search: () => Promise<unknown>): Promise<number> {
  const startedAt = performance.now();
  await search();
  return performance.now() - startedAt;
}

async function seedCorpus(
  store: CanonicalStore,
  items: readonly CorpusItem[],
  vectorsByText: Map<string, readonly number[]>,
): Promise<void> {
  for (const [sequence, item] of items.entries()) {
    const value = claim(item);
    vectorsByText.set(claimText(value), item.vector);
    await store.assertClaim(value);
    await store.putEmbedding({ claimId: value.id, vector: item.vector });
    await store.appendEvent(event(item, sequence + 1));
  }
}

async function benchmarkScenario(
  projection: PostgresRetrievalProjection,
  items: readonly CorpusItem[],
  scenario: Scenario,
): Promise<ScenarioResult> {
  const eligible = items.filter((item) => matchesScenario(item, scenario)).length;
  const queryVectors = QUERY_INDEXES.map((index) => corpusVector(index));
  const recalls: number[] = [];
  const latencies: number[] = [];

  for (const queryVector of queryVectors.slice(0, 2)) {
    await projection.search(searchRequest(scenario, queryVector));
  }

  for (const queryVector of queryVectors) {
    const expected = exactTopK(items, scenario, queryVector);
    const request = searchRequest(scenario, queryVector);
    const startedAt = performance.now();
    const actual = await projection.search(request);
    latencies.push(performance.now() - startedAt);
    recalls.push(
      recallAtK(
        expected,
        actual.map((candidate) => candidate.claimId),
      ),
    );
  }

  return {
    name: scenario.name,
    selectivity: eligible / items.length,
    meanRecallAt10: recalls.reduce((sum, value) => sum + value, 0) / recalls.length,
    minimumRecallAt10: Math.min(...recalls),
    latency: summarizeLatency(latencies),
  };
}

async function benchmarkServingGate(input: {
  sql: SqlClient;
  store: CanonicalStore;
  projection: PostgresRetrievalProjection;
  embeddings: EmbeddingProvider;
}): Promise<CorpusResult['servingGate']> {
  const gate = createProjectionServingGate(input);
  const scenario: Scenario = { name: 'medium', namespaceId: 'namespace-a' };
  const queryVectors = QUERY_INDEXES.slice(0, 8).map((index) => corpusVector(index));
  const healthyLatencies: number[] = [];
  const fallbackLatencies: number[] = [];

  const beforeHealthy = await gate.status();
  for (const queryVector of queryVectors) {
    healthyLatencies.push(
      await timedSearch(() => gate.candidateSource.search(searchRequest(scenario, queryVector))),
    );
  }
  const afterHealthy = await gate.status();
  const healthyFallbacks = afterHealthy.canonicalFallbacks - beforeHealthy.canonicalFallbacks;

  await input.sql.exec('DROP INDEX CONCURRENTLY IF EXISTS retrieval_projection_vector_hnsw');
  const beforeFallback = await gate.status();
  for (const queryVector of queryVectors) {
    fallbackLatencies.push(
      await timedSearch(() => gate.candidateSource.search(searchRequest(scenario, queryVector))),
    );
  }
  const afterFallback = await gate.status();
  const missingIndexFallbacks =
    afterFallback.canonicalFallbacks - beforeFallback.canonicalFallbacks;

  const recoveryStartedAt = performance.now();
  await input.projection.rebuildVectorIndex();
  const recoveryRebuildMs = performance.now() - recoveryStartedAt;
  const recovered = await gate.status();
  expect(recovered.ready).toBe(true);

  return {
    healthyFallbackRate: healthyFallbacks / queryVectors.length,
    missingIndexFallbackRate: missingIndexFallbacks / queryVectors.length,
    healthyLatency: summarizeLatency(healthyLatencies),
    canonicalFallbackLatency: summarizeLatency(fallbackLatencies),
    recoveryRebuildMs,
  };
}

async function runCorpusBenchmark(sql: SqlClient, size: number): Promise<CorpusResult> {
  await sql.exec(TABLE_RESET_SQL);
  const items = corpus(size);
  const vectorsByText = new Map<string, readonly number[]>();
  const store = createPostgresCanonicalStore(sql);
  const embeddings: EmbeddingProvider = {
    id: 'pgvector-benchmark',
    async embed({ texts }) {
      return {
        vectors: texts.map((text) => {
          const vector = vectorsByText.get(text);
          if (vector === undefined) throw new Error(`missing benchmark vector for ${text}`);
          return vector;
        }),
      };
    },
  };
  const projection = createPostgresRetrievalProjection({
    sql,
    store,
    embeddings,
    vectorAcceleration: {
      kind: 'pgvector-hnsw',
      dimensions: DIMENSIONS,
      efSearch: 100,
      m: 16,
      efConstruction: 64,
    },
  });

  await seedCorpus(store, items, vectorsByText);

  const rebuildStartedAt = performance.now();
  await projection.rebuild();
  const fullProjectionRebuildMs = performance.now() - rebuildStartedAt;

  const indexStartedAt = performance.now();
  await projection.rebuildVectorIndex();
  const vectorIndexRebuildMs = performance.now() - indexStartedAt;

  const scenarios: readonly Scenario[] = [
    { name: 'broad' },
    { name: 'medium', namespaceId: 'namespace-a' },
    { name: 'narrow', namespaceId: 'namespace-rare' },
  ];
  const scenarioResults = await Promise.all(
    scenarios.map((scenario) => benchmarkScenario(projection, items, scenario)),
  );
  for (const result of scenarioResults) {
    expect(result.meanRecallAt10).toBeGreaterThanOrEqual(0.95);
    expect(result.minimumRecallAt10).toBeGreaterThanOrEqual(0.9);
  }

  const servingGate = await benchmarkServingGate({ sql, store, projection, embeddings });
  expect(servingGate.healthyFallbackRate).toBe(0);
  expect(servingGate.missingIndexFallbackRate).toBe(1);

  return {
    corpusSize: size,
    fullProjectionRebuildMs,
    vectorIndexRebuildMs,
    scenarios: scenarioResults,
    servingGate,
  };
}

async function writeBenchmarkOutput(results: readonly CorpusResult[]): Promise<void> {
  if (OUTPUT_PATH === undefined) return;
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(
    OUTPUT_PATH,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        environment: {
          dimensions: DIMENSIONS,
          efSearch: 100,
          m: 16,
          efConstruction: 64,
          limit: LIMIT,
        },
        results,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}

describeLive('pgvector HNSW rollout benchmark', () => {
  it('records recall, latency, rebuild, and fallback evidence across CI-scale corpora', async () => {
    if (DATABASE_URL === undefined) throw new Error('KOTOWARI_TEST_POSTGRES_URL is required');
    const sql = createPgPoolClient(DATABASE_URL);
    const results: CorpusResult[] = [];
    for (const size of CORPUS_SIZES) {
      results.push(await runCorpusBenchmark(sql, size));
    }
    expect(results).toHaveLength(CORPUS_SIZES.length);
    await writeBenchmarkOutput(results);
    await sql.exec(TABLE_RESET_SQL);
  }, 300_000);
});
