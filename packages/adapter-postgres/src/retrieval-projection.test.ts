import { describe, expect, it } from 'vitest';

import {
  createPostgresCanonicalStore,
  createPostgresRetrievalProjection,
  createPgliteClient,
} from './public.js';

import type { Claim, DomainEvent, EmbeddingProvider } from '@kotowari/plugin-sdk';

const NOW = '2026-08-18T00:00:00.000Z' as never;

function claim(input: {
  id: string;
  subject: string;
  predicate?: string;
  literal?: string;
  objectEntityId?: string;
  status?: Claim['status'];
}): Claim {
  return {
    tenantId: 'tenant-local' as never,
    namespaceId: 'namespace-local' as never,
    principalId: 'principal-local' as never,
    classification: 'internal',
    visibility: 'workspace',
    policyTags: [],
    id: input.id as never,
    subject: input.subject as never,
    predicate: input.predicate ?? 'description',
    object:
      input.objectEntityId === undefined
        ? { kind: 'literal', value: input.literal ?? input.id }
        : { kind: 'entity', entityId: input.objectEntityId as never },
    bitemporal: {
      validFrom: NOW,
      recordedAt: NOW,
      assertedAt: NOW,
    },
    confidence: 1,
    status: input.status ?? 'asserted',
    evidenceIds: [],
    provenance: {
      source: 'test',
      actor: 'principal-local' as never,
      process: 'test',
      timestamp: NOW,
      parentIds: [],
    },
  };
}

function event(
  kind: 'claim.asserted' | 'claim.retracted',
  claimId: string,
  sequence: number,
): DomainEvent {
  return {
    kind,
    eventId: `event-${sequence}` as never,
    tenantId: 'tenant-local' as never,
    claimId: claimId as never,
    provenance: {
      source: 'test',
      actor: 'principal-local' as never,
      process: kind,
      timestamp: NOW,
      parentIds: [],
    },
    occurredAt: `2026-08-18T00:00:0${sequence}.000Z` as never,
  };
}

const embeddings: EmbeddingProvider = {
  id: 'projection-test-embedding',
  async embed({ texts }) {
    return {
      vectors: texts.map((text) => (text.toLowerCase().includes('alpha') ? [1, 0] : [0, 1])),
    };
  },
};

async function fixture() {
  const sql = await createPgliteClient();
  const store = createPostgresCanonicalStore(sql);
  const projection = createPostgresRetrievalProjection({ sql, store, embeddings });
  return { store, projection };
}

describe('Postgres retrieval projection', () => {
  it('rebuilds lexical and vector candidates from canonical claim events', async () => {
    const { store, projection } = await fixture();
    await store.assertClaim(
      claim({ id: 'claim-alpha', subject: 'entity-a', literal: 'alpha vendor' }),
    );
    await store.appendEvent(event('claim.asserted', 'claim-alpha', 1));
    await store.assertClaim(
      claim({ id: 'claim-beta', subject: 'entity-b', literal: 'beta vendor' }),
    );
    await store.appendEvent(event('claim.asserted', 'claim-beta', 2));

    await projection.rebuild();

    const lexical = await projection.search({
      tenantId: 'tenant-local' as never,
      namespaceId: 'namespace-local' as never,
      strategy: 'lexical',
      query: 'alpha',
      limit: 10,
    });
    expect(lexical.map((candidate) => candidate.claimId)).toEqual(['claim-alpha']);

    const vector = await projection.search({
      tenantId: 'tenant-local' as never,
      namespaceId: 'namespace-local' as never,
      strategy: 'vector',
      query: 'alpha',
      queryVector: [1, 0],
      limit: 10,
    });
    expect(vector[0]?.claimId).toBe('claim-alpha');
    expect((await projection.status()).stale).toBe(false);
  });

  it('tracks freshness and incrementally removes retracted claims', async () => {
    const { store, projection } = await fixture();
    const asserted = claim({ id: 'claim-alpha', subject: 'entity-a', literal: 'alpha vendor' });
    await store.assertClaim(asserted);
    await store.appendEvent(event('claim.asserted', 'claim-alpha', 1));
    expect((await projection.status()).stale).toBe(true);

    await projection.sync();
    expect((await projection.status()).pendingEvents).toBe(0);

    await store.retractClaim({ ...asserted, status: 'retracted' });
    await store.appendEvent(event('claim.retracted', 'claim-alpha', 2));
    expect((await projection.status()).pendingEvents).toBe(1);

    await projection.sync();
    const candidates = await projection.search({
      tenantId: 'tenant-local' as never,
      namespaceId: 'namespace-local' as never,
      strategy: 'lexical',
      query: 'alpha',
      limit: 10,
    });
    expect(candidates).toEqual([]);
    expect((await projection.status()).stale).toBe(false);
  });

  it('rebuilds graph identity after entity merges', async () => {
    const { store, projection } = await fixture();
    await store.assertClaim(
      claim({ id: 'claim-a', subject: 'entity-a', objectEntityId: 'entity-shared' }),
    );
    await store.appendEvent(event('claim.asserted', 'claim-a', 1));
    await store.assertClaim(
      claim({ id: 'claim-b', subject: 'entity-absorbed', objectEntityId: 'entity-z' }),
    );
    await store.appendEvent(event('claim.asserted', 'claim-b', 2));
    await projection.rebuild();

    const merge: DomainEvent = {
      kind: 'entity.merged',
      eventId: 'event-3' as never,
      tenantId: 'tenant-local' as never,
      survivingEntityId: 'entity-shared' as never,
      absorbedEntityIds: ['entity-absorbed' as never],
      provenance: {
        source: 'test',
        actor: 'principal-local' as never,
        process: 'entity.merge',
        timestamp: NOW,
        parentIds: [],
      },
      occurredAt: '2026-08-18T00:00:03.000Z' as never,
    };
    await store.appendEvent(merge);
    await projection.sync();

    const graph = await projection.search({
      tenantId: 'tenant-local' as never,
      namespaceId: 'namespace-local' as never,
      strategy: 'graph',
      query: '',
      seedClaimIds: ['claim-a' as never],
      hops: 1,
      limit: 10,
    });
    expect(graph.map((candidate) => candidate.claimId)).toContain('claim-b');
  });

  it('fails closed for historical knownAt reads', async () => {
    const { projection } = await fixture();
    await expect(
      projection.search({
        tenantId: 'tenant-local' as never,
        namespaceId: 'namespace-local' as never,
        strategy: 'lexical',
        query: 'alpha',
        limit: 10,
        temporal: { knownAt: NOW },
      }),
    ).rejects.toThrow('current-knowledge reads only');
  });
});
