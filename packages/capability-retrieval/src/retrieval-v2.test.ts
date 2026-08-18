import { localStandalonePrincipal } from '@kotowari/kernel';
import { createMemoryCanonicalStore } from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { evaluateRetrieval } from './evaluation.js';
import { reciprocalRankFuse } from './fusion.js';
import { retrieve } from './retrieve.js';

import type { Claim } from '@kotowari/kernel';
import type { CanonicalStore, RetrievalCandidateSource } from '@kotowari/plugin-sdk';

function claim(id: string, value: string): Claim {
  const principal = localStandalonePrincipal();
  const now = '2026-01-01T00:00:00.000Z' as never;
  return {
    tenantId: principal.tenantId,
    namespaceId: principal.namespaceIds[0] ?? ('ns' as never),
    principalId: principal.id,
    classification: 'internal',
    visibility: 'workspace',
    policyTags: [],
    id: id as never,
    subject: 'entity-1' as never,
    predicate: 'description',
    object: { kind: 'literal', value },
    bitemporal: { validFrom: now, recordedAt: now, assertedAt: now },
    confidence: 1,
    status: 'asserted',
    evidenceIds: [],
    provenance: {
      source: 'test',
      actor: principal.id,
      process: 'test',
      timestamp: now,
      parentIds: [],
    },
  };
}

async function seed(store: CanonicalStore): Promise<void> {
  await store.assertClaim(claim('c-a', 'alpha'));
  await store.assertClaim(claim('c-b', 'beta'));
  await store.assertClaim(claim('c-c', 'gamma'));
}

describe('retrieval architecture v2', () => {
  it('fuses independent ranked lists deterministically', () => {
    const fused = reciprocalRankFuse([
      {
        strategy: 'lexical',
        candidates: [{ claimId: 'c-a' as never }, { claimId: 'c-b' as never }],
      },
      {
        strategy: 'vector',
        candidates: [{ claimId: 'c-b' as never }, { claimId: 'c-c' as never }],
      },
    ]);
    expect(fused[0]?.claimId).toBe('c-b');
    expect(fused[0]?.scoreComponents).toHaveProperty('lexical');
    expect(fused[0]?.scoreComponents).toHaveProperty('vector');
  });

  it('uses an external candidate source without scanning canonical claims or embeddings', async () => {
    const backing = createMemoryCanonicalStore();
    await seed(backing);
    const calls: string[] = [];
    const source: RetrievalCandidateSource = {
      id: 'test-index',
      async search(request) {
        calls.push(request.strategy);
        if (request.strategy === 'lexical') {
          return [{ claimId: 'c-a' as never }, { claimId: 'c-b' as never }];
        }
        if (request.strategy === 'vector') {
          return [{ claimId: 'c-b' as never }, { claimId: 'c-c' as never }];
        }
        expect(request.seedClaimIds?.length).toBeGreaterThan(0);
        return [{ claimId: 'c-c' as never, graphRoute: ['entity-1'] }];
      },
    };
    const store: CanonicalStore = new Proxy(backing, {
      get(target, property, receiver) {
        if (property === 'listClaims' || property === 'listEmbeddings') {
          return async () => {
            throw new Error(`unexpected full scan: ${String(property)}`);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? (value as Function).bind(target) : value;
      },
    });
    const principal = localStandalonePrincipal();
    const result = await retrieve({
      store,
      candidateSource: source,
      embeddings: {
        id: 'embeddings',
        embed: async ({ texts }) => ({ vectors: texts.map(() => [1, 0]) }),
      },
      principal,
      authz: { tenantId: principal.tenantId },
      query: 'alpha',
    });
    expect(result.hits[0]?.claimId).toBe('c-b');
    expect(result.receipt.provenance.source).toBe('test-index');
    expect(calls).toEqual(['lexical', 'vector', 'graph']);
  });

  it('calculates retrieval quality metrics for repeatable evaluation', () => {
    const metrics = evaluateRetrieval(
      [
        { id: 'q1', relevantClaimIds: ['a', 'b'], retrievedClaimIds: ['a', 'x', 'b'] },
        { id: 'q2', relevantClaimIds: ['c'], retrievedClaimIds: ['x', 'c'] },
      ],
      2,
    );
    expect(metrics.cases).toBe(2);
    expect(metrics.precisionAtK).toBe(0.5);
    expect(metrics.recallAtK).toBe(0.75);
    expect(metrics.hitRateAtK).toBe(1);
    expect(metrics.meanReciprocalRank).toBe(0.75);
  });
});
