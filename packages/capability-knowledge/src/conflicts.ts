import {
  asClaimId,
  buildConflictResolved,
  compactProvenance,
  type ClaimId,
  type Conflict,
  type ConflictResolution,
  type Principal,
} from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

function sameClaimSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((id, index) => id === sortedRight[index]);
}

async function existingConflictId(
  store: CanonicalStore,
  tenantId: Conflict['tenantId'],
  claimIds: readonly ClaimId[],
): Promise<Conflict['id'] | undefined> {
  const conflicts = await store.listConflicts({ tenantId });
  return conflicts.find((conflict) => sameClaimSet(conflict.claimIds, claimIds))?.id;
}

export async function resolveClaimConflict(input: {
  store: CanonicalStore;
  principal: Principal;
  claimIds: readonly [string, string, ...string[]];
  preferredClaimId: string;
  reason: string;
}): Promise<ConflictResolution> {
  const namespaceId = input.principal.namespaceIds[0];
  if (namespaceId === undefined) {
    throw new Error('Principal has no namespace');
  }
  const claimIds = input.claimIds.map((id) => asClaimId(id));
  const conflictId = await existingConflictId(input.store, input.principal.tenantId, claimIds);
  const { conflict, resolution, event } = buildConflictResolved({
    metadata: {
      tenantId: input.principal.tenantId,
      namespaceId,
      principalId: input.principal.id,
      classification: 'internal',
      visibility: 'workspace',
      policyTags: [],
    },
    kind: 'value',
    claimIds,
    strategy: 'human_review',
    preferredClaimId: asClaimId(input.preferredClaimId),
    reason: input.reason,
    provenance: compactProvenance({
      source: 'curator',
      actor: input.principal.id,
      process: 'conflict.resolve',
    }),
    ...(conflictId === undefined ? {} : { conflictId }),
  });
  await input.store.withTransaction(async (tx) => {
    await tx.putConflict(conflict);
    await tx.putResolution(resolution);
    await tx.appendEvent(event);
    await tx.appendOutbox(event);
  });
  return resolution;
}
