import {
  asIsoTimestamp,
  asPrincipalId,
  buildClaimAsserted,
  buildEntity,
  buildEntityMerged,
  compactProvenance,
  localStandaloneMetadata,
  localStandalonePrincipal,
  newId,
} from '@kotowari/kernel';
import { createMemoryCanonicalStore } from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { detectClaimConflicts, resolveClaimConflict } from './conflicts.js';

import type {
  CardinalityConflictRule,
  Claim,
  Entity,
  Principal,
  ScopedMetadata,
} from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

const SINGLE_NAME_RULE: CardinalityConflictRule = {
  kind: 'max-cardinality',
  predicate: 'legalName',
  terms: ['legalName', 'name'],
  max: 1,
  source: 'semantic-contract:crm@1',
};

function provenance(principal: Principal, process: string) {
  return compactProvenance({ source: 'test', actor: principal.id, process });
}

async function putEntity(
  store: CanonicalStore,
  principal: Principal,
  label: string,
): Promise<Entity> {
  const entity = buildEntity({
    metadata: localStandaloneMetadata(principal.id),
    labels: [label],
    aliases: [],
    provenance: provenance(principal, 'entity'),
  });
  await store.putEntity(entity);
  return entity;
}

async function putClaim(input: {
  store: CanonicalStore;
  principal: Principal;
  subject: Entity;
  predicate?: string;
  value?: string;
  objectEntity?: Entity;
  validFrom?: string;
  validTo?: string;
  metadata?: ScopedMetadata;
}): Promise<Claim> {
  const { claim } = buildClaimAsserted({
    metadata: input.metadata ?? localStandaloneMetadata(input.principal.id),
    subject: input.subject.id,
    predicate: input.predicate ?? 'legalName',
    object:
      input.objectEntity === undefined
        ? { kind: 'literal', value: input.value ?? 'Acme' }
        : { kind: 'entity', entityId: input.objectEntity.id },
    validFrom: asIsoTimestamp(input.validFrom ?? '2026-01-01T00:00:00.000Z'),
    ...(input.validTo === undefined ? {} : { validTo: asIsoTimestamp(input.validTo) }),
    assertedAt: asIsoTimestamp('2026-01-01T00:00:00.000Z'),
    confidence: 1,
    evidenceIds: [newId('EvidenceId')],
    provenance: provenance(input.principal, 'claim'),
  });
  await input.store.assertClaim(claim);
  return claim;
}

describe('semantic conflict detection v1', () => {
  it('detects, persists, and idempotently reuses a max-cardinality conflict', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const company = await putEntity(store, principal, 'Acme');
    const first = await putClaim({ store, principal, subject: company, value: 'Acme Inc.' });
    const second = await putClaim({ store, principal, subject: company, value: 'ACME Ltd.' });

    const conflicts = await detectClaimConflicts({
      store,
      principal,
      rules: [SINGLE_NAME_RULE],
    });

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.claimIds).toEqual([first.id, second.id].sort());
    expect(conflicts[0]?.cause).toMatchObject({
      kind: 'max-cardinality',
      subject: company.id,
      predicate: 'legalName',
      max: 1,
      ruleSource: 'semantic-contract:crm@1',
    });
    expect((await store.listEvents()).map((event) => event.kind)).toContain(
      'conflict.detected',
    );
    expect(await detectClaimConflicts({ store, principal, rules: [SINGLE_NAME_RULE] })).toEqual(
      [],
    );
  });

  it('uses half-open validity intervals and ignores equal values', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const company = await putEntity(store, principal, 'Acme');
    await putClaim({
      store,
      principal,
      subject: company,
      value: 'Acme',
      validTo: '2026-02-01T00:00:00.000Z',
    });
    await putClaim({
      store,
      principal,
      subject: company,
      value: 'Different Later Name',
      validFrom: '2026-02-01T00:00:00.000Z',
    });
    await putClaim({
      store,
      principal,
      subject: company,
      value: 'Different Later Name',
      validFrom: '2026-02-01T00:00:00.000Z',
    });

    expect(await detectClaimConflicts({ store, principal, rules: [SINGLE_NAME_RULE] })).toEqual(
      [],
    );
  });

  it('supports cardinalities greater than one', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const company = await putEntity(store, principal, 'Acme');
    const rule: CardinalityConflictRule = {
      kind: 'max-cardinality',
      predicate: 'director',
      terms: ['director'],
      max: 2,
    };
    await putClaim({ store, principal, subject: company, predicate: 'director', value: 'A' });
    await putClaim({ store, principal, subject: company, predicate: 'director', value: 'B' });
    await putClaim({ store, principal, subject: company, predicate: 'director', value: 'C' });

    const conflicts = await detectClaimConflicts({ store, principal, rules: [rule] });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.claimIds).toHaveLength(3);
  });

  it('canonicalizes merged subjects before detecting conflicts', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const survivor = await putEntity(store, principal, 'Acme Corporation');
    const absorbed = await putEntity(store, principal, 'ACME Corp');
    const { event } = buildEntityMerged(
      {
        metadata: localStandaloneMetadata(principal.id),
        survivingEntityId: survivor.id,
        absorbedEntityIds: [absorbed.id],
        provenance: provenance(principal, 'merge'),
      },
      survivor,
    );
    await store.appendEvent(event);
    await putClaim({ store, principal, subject: survivor, value: 'Acme Corporation' });
    await putClaim({ store, principal, subject: absorbed, value: 'ACME Holdings' });

    const conflicts = await detectClaimConflicts({
      store,
      principal,
      rules: [SINGLE_NAME_RULE],
    });
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.cause?.subject).toBe(survivor.id);
  });

  it('canonicalizes entity-valued objects so aliases do not become false conflicts', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const company = await putEntity(store, principal, 'Acme');
    const survivor = await putEntity(store, principal, 'Tokyo');
    const absorbed = await putEntity(store, principal, 'Tokyo-to');
    const { event } = buildEntityMerged(
      {
        metadata: localStandaloneMetadata(principal.id),
        survivingEntityId: survivor.id,
        absorbedEntityIds: [absorbed.id],
        provenance: provenance(principal, 'merge-object'),
      },
      survivor,
    );
    await store.appendEvent(event);
    await putClaim({
      store,
      principal,
      subject: company,
      predicate: 'headquarters',
      objectEntity: survivor,
    });
    await putClaim({
      store,
      principal,
      subject: company,
      predicate: 'headquarters',
      objectEntity: absorbed,
    });
    const rule: CardinalityConflictRule = {
      kind: 'max-cardinality',
      predicate: 'headquarters',
      terms: ['headquarters'],
      max: 1,
    };

    expect(await detectClaimConflicts({ store, principal, rules: [rule] })).toEqual([]);
  });

  it('does not disclose unreadable claims and prevents viewers from recording conflicts', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const company = await putEntity(store, principal, 'Acme');
    await putClaim({ store, principal, subject: company, value: 'Visible' });
    await putClaim({
      store,
      principal,
      subject: company,
      value: 'Secret',
      metadata: {
        ...localStandaloneMetadata(asPrincipalId('other-user')),
        visibility: 'private',
      },
    });
    expect(await detectClaimConflicts({ store, principal, rules: [SINGLE_NAME_RULE] })).toEqual(
      [],
    );

    await putClaim({ store, principal, subject: company, value: 'Visible conflict' });
    const viewer: Principal = { ...principal, roles: ['viewer'] };
    await expect(
      detectClaimConflicts({ store, principal: viewer, rules: [SINGLE_NAME_RULE] }),
    ).rejects.toThrow('Denied conflict.detect');
  });

  it('resolves a detected conflict under the same immutable conflict id', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const company = await putEntity(store, principal, 'Acme');
    const first = await putClaim({ store, principal, subject: company, value: 'Acme Inc.' });
    const second = await putClaim({ store, principal, subject: company, value: 'ACME Ltd.' });
    const [conflict] = await detectClaimConflicts({
      store,
      principal,
      rules: [SINGLE_NAME_RULE],
    });
    if (conflict === undefined) {
      throw new Error('Expected detected conflict');
    }

    const resolution = await resolveClaimConflict({
      store,
      principal,
      conflictId: conflict.id,
      claimIds: [first.id, second.id],
      preferredClaimId: first.id,
      reason: 'Verified against the corporate registry',
    });

    expect(resolution.id).toBe(conflict.id);
    expect((await store.listResolutions({ tenantId: principal.tenantId }))[0]?.id).toBe(
      conflict.id,
    );
    await expect(
      resolveClaimConflict({
        store,
        principal,
        conflictId: conflict.id,
        claimIds: [first.id, second.id],
        preferredClaimId: first.id,
        reason: 'Duplicate review',
      }),
    ).rejects.toThrow('already resolved');
  });
});
