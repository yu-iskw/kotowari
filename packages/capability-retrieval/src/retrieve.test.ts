import { localStandalonePrincipal } from '@kotowari/kernel';
import { createMemoryCanonicalStore } from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { RETRIEVAL_PLAN_VERSION, retrieve } from './retrieve.js';

import type { Claim } from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

async function seedTwoSubjects(store: CanonicalStore): Promise<void> {
  const principal = localStandalonePrincipal();
  const meta = {
    tenantId: principal.tenantId,
    namespaceId: principal.namespaceIds[0] ?? ('ns' as never),
    principalId: principal.id,
    classification: 'internal' as const,
    visibility: 'workspace' as const,
    policyTags: [] as const,
  };
  const now = '2024-01-01T00:00:00.000Z' as never;
  const provenance = {
    source: 'test',
    actor: principal.id,
    process: 'test',
    timestamp: now,
    parentIds: [] as const,
  };
  const claim = (id: string, subject: string, predicate: string, value: string): Claim => ({
    ...meta,
    id: id as never,
    subject: subject as never,
    predicate,
    object: { kind: 'literal', value },
    bitemporal: { validFrom: now, recordedAt: now, assertedAt: now },
    confidence: 1,
    status: 'asserted',
    evidenceIds: [],
    provenance,
  });
  await store.assertClaim(claim('c-lex', 'e-alice', 'is_ceo_of', 'Vendor X'));
  await store.assertClaim(claim('c-other', 'e-bob', 'works_at', 'Vendor X'));
  await store.assertClaim(claim('c-graph', 'e-alice', 'lives_in', 'Austin'));
}

describe('retrieval plan limits and hops', () => {
  it('honors lexical limit independently of graph hops', async () => {
    const store = createMemoryCanonicalStore();
    await seedTwoSubjects(store);
    const principal = localStandalonePrincipal();
    const limited = await retrieve({
      store,
      embeddings: {
        id: 'e',
        embed: async ({ texts }) => ({ vectors: texts.map(() => [1, 0]) }),
      },
      principal,
      authz: { tenantId: principal.tenantId },
      query: 'Vendor X',
      temporal: {
        validAt: '2024-01-01T00:00:00.000Z',
        knownAt: '2024-01-01T00:00:00.000Z',
      },
      plan: {
        candidates: [
          { strategy: 'lexical', limit: 1 },
          { strategy: 'vector', limit: 0 },
          { strategy: 'graph', hops: 0 },
        ],
        rerank: 'none',
        budget: 20,
        explain: true,
      },
    });
    expect(limited.hits.length).toBe(1);
    expect(limited.receipt.planVersion).toBe(RETRIEVAL_PLAN_VERSION);
    expect(limited.receipt.temporal).toEqual({
      validAt: '2024-01-01T00:00:00.000Z',
      knownAt: '2024-01-01T00:00:00.000Z',
    });
    expect(await store.getRetrievalReceipt(limited.receipt.id)).toEqual(limited.receipt);

    const hopped = await retrieve({
      store,
      embeddings: {
        id: 'e',
        embed: async ({ texts }) => ({ vectors: texts.map(() => [1, 0]) }),
      },
      principal,
      authz: { tenantId: principal.tenantId },
      query: 'Vendor X',
      plan: {
        candidates: [
          { strategy: 'lexical', limit: 1 },
          { strategy: 'vector', limit: 0 },
          { strategy: 'graph', hops: 2 },
        ],
        rerank: 'none',
        budget: 20,
        explain: true,
      },
    });
    expect(hopped.hits.some((hit) => hit.claimId === 'c-graph')).toBe(true);
    expect(hopped.hits.some((hit) => hit.scoreComponents.graph !== undefined)).toBe(true);
  });
});
