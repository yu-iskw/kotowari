import {
  asIsoTimestamp,
  asPrincipalId,
  buildClaimAsserted,
  buildEntity,
  compactProvenance,
  localStandaloneMetadata,
  localStandalonePrincipal,
  newId,
} from '@kotowari/kernel';
import { createMemoryCanonicalStore } from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import {
  decideEntityResolutionProposal,
  findEntityResolutionCandidates,
  findEntityResolutionCandidatesForEntity,
  listEntityMergeLineage,
  mergeApprovedEntityResolution,
  normalizeEntityName,
  recordEntityResolutionProposal,
  resolveCanonicalEntity,
  revertEntityMerge,
} from './entity-resolution.js';

import type { Entity, Principal } from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

function provenance(principal: Principal, process = 'test') {
  return compactProvenance({ source: 'test', actor: principal.id, process });
}

async function putEntity(
  store: CanonicalStore,
  principal: Principal,
  label: string,
  input: {
    aliases?: readonly string[];
    externalIds?: readonly { system: string; value: string }[];
    privateOwner?: string;
  } = {},
): Promise<Entity> {
  const metadata = {
    ...localStandaloneMetadata(principal.id),
    tenantId: principal.tenantId,
    namespaceId: principal.namespaceIds[0] ?? localStandaloneMetadata().namespaceId,
    ...(input.privateOwner === undefined
      ? {}
      : {
          principalId: asPrincipalId(input.privateOwner),
          visibility: 'private' as const,
        }),
  };
  const entity = buildEntity({
    metadata,
    labels: [label],
    aliases: input.aliases ?? [],
    ...(input.externalIds === undefined ? {} : { externalIds: input.externalIds }),
    provenance: provenance(principal, 'put-entity'),
  });
  await store.putEntity(entity);
  return entity;
}

async function approvedProposal(
  store: CanonicalStore,
  principal: Principal,
  source: Entity,
  candidate: Entity,
) {
  const proposal = await recordEntityResolutionProposal({
    store,
    principal,
    sourceEntityId: source.id,
    candidateEntityId: candidate.id,
  });
  const decision = await decideEntityResolutionProposal({
    store,
    principal,
    proposalId: proposal.id,
    outcome: 'approved',
    reason: 'same enterprise identity',
  });
  return { proposal, decision };
}

describe('entity identity and resolution v1', () => {
  it('discovers unreferenced entities and normalizes Unicode names', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const entity = await putEntity(store, principal, 'ＡＣＭＥ　株式会社');

    expect(normalizeEntityName('ＡＣＭＥ　株式会社')).toBe('acme 株式会社');
    const candidates = await findEntityResolutionCandidates({
      store,
      principal,
      label: 'ACME 株式会社',
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.entity.id).toBe(entity.id);
    expect(candidates[0]?.signals[0]?.kind).toBe('label-exact');
  });

  it('uses exact external identifiers as the strongest deterministic signal', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const entity = await putEntity(store, principal, 'Completely Different Name', {
      externalIds: [{ system: 'crm', value: 'C-0042' }],
    });

    const candidates = await findEntityResolutionCandidates({
      store,
      principal,
      label: 'no lexical match',
      externalIds: [{ system: 'CRM', value: 'C-0042' }],
    });

    expect(candidates[0]?.entity.id).toBe(entity.id);
    expect(candidates[0]?.score).toBe(1);
    expect(candidates[0]?.signals[0]?.kind).toBe('external-id-exact');
  });

  it('does not expose candidates the principal cannot read', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    await putEntity(store, principal, 'Visible Entity');
    await putEntity(store, principal, 'Secret Entity', { privateOwner: 'other-user' });

    const candidates = await findEntityResolutionCandidates({
      store,
      principal,
      label: 'Secret Entity',
    });

    expect(candidates).toEqual([]);
  });

  it('records proposal and review events with principal-derived actor identity', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const source = await putEntity(store, principal, 'Acme Corporation');
    const candidate = await putEntity(store, principal, 'ACME Corporation');

    const proposal = await recordEntityResolutionProposal({
      store,
      principal,
      sourceEntityId: source.id,
      candidateEntityId: candidate.id,
    });
    const decision = await decideEntityResolutionProposal({
      store,
      principal,
      proposalId: proposal.id,
      outcome: 'approved',
      reason: 'curator verified the identity',
    });

    expect(proposal.proposedBy).toBe(principal.id);
    expect(decision.decidedBy).toBe(principal.id);
    expect(decision.proposalId).toBe(proposal.id);
    const events = await store.listEvents();
    expect(events.map((event) => event.kind)).toEqual([
      'entity.resolution_proposed',
      'entity.resolution_decided',
    ]);
    expect((await store.listOutbox()).map((event) => event.kind)).toEqual([
      'entity.resolution_proposed',
      'entity.resolution_decided',
    ]);
  });

  it('prevents a proposal from being decided twice', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const source = await putEntity(store, principal, 'Globex LLC');
    const candidate = await putEntity(store, principal, 'GLOBEX LLC');
    const proposal = await recordEntityResolutionProposal({
      store,
      principal,
      sourceEntityId: source.id,
      candidateEntityId: candidate.id,
    });
    await decideEntityResolutionProposal({
      store,
      principal,
      proposalId: proposal.id,
      outcome: 'rejected',
      reason: 'different legal entities',
    });

    await expect(
      decideEntityResolutionProposal({
        store,
        principal,
        proposalId: proposal.id,
        outcome: 'approved',
        reason: 'changed mind',
      }),
    ).rejects.toThrow('already decided');
  });

  it('does not merge a rejected resolution proposal', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const source = await putEntity(store, principal, 'Northwind Trading');
    const candidate = await putEntity(store, principal, 'Northwind Trading');
    const proposal = await recordEntityResolutionProposal({
      store,
      principal,
      sourceEntityId: source.id,
      candidateEntityId: candidate.id,
    });
    await decideEntityResolutionProposal({
      store,
      principal,
      proposalId: proposal.id,
      outcome: 'rejected',
      reason: 'same name but different registration',
    });

    await expect(
      mergeApprovedEntityResolution({
        store,
        principal,
        proposalId: proposal.id,
        survivingEntityId: source.id,
      }),
    ).rejects.toThrow('not approved');
  });

  it('merges non-destructively and keeps absorbed identities searchable through the canonical root', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const survivor = await putEntity(store, principal, 'International Business Machines', {
      aliases: ['IBM'],
    });
    const absorbed = await putEntity(store, principal, 'IBM', {
      aliases: ['I.B.M.'],
    });
    const { proposal } = await approvedProposal(store, principal, survivor, absorbed);

    const { claim } = buildClaimAsserted({
      metadata: localStandaloneMetadata(principal.id),
      subject: absorbed.id,
      predicate: 'industry',
      object: { kind: 'literal', value: 'technology' },
      validFrom: asIsoTimestamp('2026-01-01T00:00:00.000Z'),
      assertedAt: asIsoTimestamp('2026-01-01T00:00:00.000Z'),
      confidence: 1,
      evidenceIds: [newId('EvidenceId')],
      provenance: provenance(principal, 'assert-claim'),
    });
    await store.assertClaim(claim);

    const lineage = await mergeApprovedEntityResolution({
      store,
      principal,
      proposalId: proposal.id,
      survivingEntityId: survivor.id,
    });

    expect(lineage.survivingEntityId).toBe(survivor.id);
    expect(lineage.absorbedEntityIds).toEqual([absorbed.id]);
    expect((await store.getEntity(absorbed.id))?.id).toBe(absorbed.id);
    expect((await store.getClaim(claim.id))?.subject).toBe(absorbed.id);
    expect(
      (await resolveCanonicalEntity({ store, principal, entityId: absorbed.id })).id,
    ).toBe(survivor.id);

    const candidates = await findEntityResolutionCandidates({
      store,
      principal,
      label: 'I.B.M.',
    });
    expect(candidates[0]?.entity.id).toBe(survivor.id);
    expect(candidates[0]?.matchedEntityIds).toContain(absorbed.id);
  });

  it('requires merge inputs to remain canonical roots', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const first = await putEntity(store, principal, 'Contoso');
    const duplicate = await putEntity(store, principal, 'CONTOSO');
    const third = await putEntity(store, principal, 'Contoso Holdings', { aliases: ['Contoso'] });
    const { proposal } = await approvedProposal(store, principal, first, duplicate);
    await mergeApprovedEntityResolution({
      store,
      principal,
      proposalId: proposal.id,
      survivingEntityId: first.id,
    });

    await expect(
      recordEntityResolutionProposal({
        store,
        principal,
        sourceEntityId: duplicate.id,
        candidateEntityId: third.id,
      }),
    ).rejects.toThrow('already absorbed');
  });

  it('reverts canonicalization without deleting merge history', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const survivor = await putEntity(store, principal, 'Wayne Enterprises');
    const absorbed = await putEntity(store, principal, 'WAYNE ENTERPRISES');
    const { proposal } = await approvedProposal(store, principal, survivor, absorbed);
    const merged = await mergeApprovedEntityResolution({
      store,
      principal,
      proposalId: proposal.id,
      survivingEntityId: survivor.id,
    });

    const reverted = await revertEntityMerge({
      store,
      principal,
      mergeEventId: merged.mergeEventId,
      reason: 'later evidence showed separate legal registrations',
    });

    expect(reverted.revertedByEventId).toBeDefined();
    expect(reverted.revertReason).toContain('separate legal registrations');
    expect(
      (await resolveCanonicalEntity({ store, principal, entityId: absorbed.id })).id,
    ).toBe(absorbed.id);
    const lineage = await listEntityMergeLineage({ store, principal, entityId: absorbed.id });
    expect(lineage).toHaveLength(1);
    expect(lineage[0]?.mergeEventId).toBe(merged.mergeEventId);
    expect((await store.listEvents()).map((event) => event.kind)).toContain('entity.merge_reverted');
  });

  it('finds candidates for an entity while excluding its existing canonical cluster', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const source = await putEntity(store, principal, 'Stark Industries', { aliases: ['Stark'] });
    const candidate = await putEntity(store, principal, 'Stark', { aliases: ['Stark Industries'] });

    const candidates = await findEntityResolutionCandidatesForEntity({
      store,
      principal,
      entityId: source.id,
    });

    expect(candidates.map((item) => item.entity.id)).toContain(candidate.id);
    expect(candidates.map((item) => item.entity.id)).not.toContain(source.id);
  });

  it('denies resolution writes to viewers', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const source = await putEntity(store, principal, 'Umbrella Corporation');
    const candidate = await putEntity(store, principal, 'UMBRELLA CORPORATION');
    const viewer: Principal = { ...principal, roles: ['viewer'] };

    await expect(
      recordEntityResolutionProposal({
        store,
        principal: viewer,
        sourceEntityId: source.id,
        candidateEntityId: candidate.id,
      }),
    ).rejects.toThrow('Denied entity.resolve');
  });
});
