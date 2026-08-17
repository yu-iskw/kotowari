import { asClaimId, buildConflictResolved, compactProvenance } from '@kotowari/kernel';

import type { ConflictResolution, Principal } from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

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
  const { resolution, event } = buildConflictResolved({
    metadata: {
      tenantId: input.principal.tenantId,
      namespaceId,
      principalId: input.principal.id,
      classification: 'internal',
      visibility: 'workspace',
      policyTags: [],
    },
    kind: 'value',
    claimIds: input.claimIds.map((id) => asClaimId(id)),
    strategy: 'human_review',
    preferredClaimId: asClaimId(input.preferredClaimId),
    reason: input.reason,
    provenance: compactProvenance({
      source: 'curator',
      actor: input.principal.id,
      process: 'conflict.resolve',
    }),
  });
  await input.store.withTransaction(async (tx) => {
    await tx.putResolution(resolution);
    await tx.appendEvent(event);
    await tx.appendOutbox(event);
  });
  return resolution;
}
