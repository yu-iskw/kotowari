import {
  buildEntity,
  canonicalStoreComplianceTests,
  compactProvenance,
  decisionLifecycleStoreComplianceTests,
  localStandaloneMetadata,
  localStandalonePrincipal,
} from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { createPgliteCanonicalStore } from './postgres-store.js';

const factory = () => createPgliteCanonicalStore();

canonicalStoreComplianceTests(factory);
decisionLifecycleStoreComplianceTests(factory);

describe('Postgres entity catalog', () => {
  it('lists entities by tenant and namespace without requiring claims', async () => {
    const store = await factory();
    const principal = localStandalonePrincipal();
    const metadata = localStandaloneMetadata(principal.id);
    const entity = buildEntity({
      metadata,
      labels: ['Unreferenced Postgres entity'],
      provenance: compactProvenance({
        source: 'test',
        actor: principal.id,
        process: 'postgres-list-entities',
      }),
    });

    await store.putEntity(entity);

    expect(
      await store.listEntities({
        tenantId: metadata.tenantId,
        namespaceId: metadata.namespaceId,
      }),
    ).toEqual([entity]);
  });
});
