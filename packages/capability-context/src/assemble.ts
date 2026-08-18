import { buildContextSnapshot, localStandaloneMetadata } from '@kotowari/kernel';

import type {
  ClaimId,
  EvidenceId,
  PolicyVersionRef,
  Principal,
  RetrievalReceiptId,
  TemporalPerspective,
} from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

type ContextItem = {
  claimId: ClaimId;
  evidenceIds: readonly EvidenceId[];
};

export async function assembleContext(input: {
  store: CanonicalStore;
  principal: Principal;
  purpose: string;
  temporal?: TemporalPerspective;
  retrievalReceiptId?: RetrievalReceiptId;
  policyVersions: readonly PolicyVersionRef[];
  items: readonly ContextItem[];
  budget: number;
}): Promise<ReturnType<typeof buildContextSnapshot>> {
  const fallback = localStandaloneMetadata(input.principal.id);
  const claimIds = input.items.map((item) => item.claimId);
  const evidenceIds: EvidenceId[] = [];
  const seen = new Set<string>();
  for (const item of input.items) {
    for (const evidenceId of item.evidenceIds) {
      if (!seen.has(evidenceId)) {
        seen.add(evidenceId);
        evidenceIds.push(evidenceId);
      }
    }
  }
  const snapshot = buildContextSnapshot({
    metadata: {
      tenantId: input.principal.tenantId,
      namespaceId: input.principal.namespaceIds[0] ?? fallback.namespaceId,
      principalId: input.principal.id,
      classification: 'internal',
      visibility: 'workspace',
      policyTags: [input.purpose],
    },
    purpose: input.purpose,
    temporal: input.temporal,
    retrievalReceiptId: input.retrievalReceiptId,
    claimIds,
    evidenceIds,
    policyVersions: input.policyVersions,
    items: input.items,
    budget: input.budget,
  });
  await input.store.putContextSnapshot(snapshot);
  return snapshot;
}
