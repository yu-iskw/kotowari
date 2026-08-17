import { allow, compactProvenance, newId, nowIso } from '@kotowari/kernel';

import type { MemoryRecord, Principal } from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

export async function recordMemory(input: {
  store: CanonicalStore;
  principal: Principal;
  body: string;
  kind?: MemoryRecord['kind'];
}): Promise<MemoryRecord> {
  const namespaceId = input.principal.namespaceIds[0];
  if (namespaceId === undefined) {
    throw new Error('Principal has no namespace');
  }
  const record: MemoryRecord = {
    id: newId('MemoryId'),
    tenantId: input.principal.tenantId,
    namespaceId,
    principalId: input.principal.id,
    classification: 'internal',
    visibility: 'private',
    policyTags: [],
    kind: input.kind ?? 'note',
    body: input.body,
    actor: input.principal.id,
    recordedAt: nowIso(),
    provenance: compactProvenance({ source: 'memory', actor: input.principal.id, process: 'memory.record' }),
  };
  await input.store.putMemory(record);
  return record;
}

export async function searchMemory(input: {
  store: CanonicalStore;
  principal: Principal;
  query: string;
}): Promise<readonly MemoryRecord[]> {
  const records = await input.store.listMemory({
    tenantId: input.principal.tenantId,
    namespaceId: input.principal.namespaceIds[0],
  });
  const needle = input.query.toLowerCase();
  return records.filter((record) => {
    if (needle.length > 0 && !record.body.toLowerCase().includes(needle)) {
      return false;
    }
    const decision = allow(
      input.principal,
      'memory.read',
      { kind: 'memory', id: record.id, metadata: record },
      { tenantId: input.principal.tenantId },
    );
    return decision.effect === 'allow';
  });
}
