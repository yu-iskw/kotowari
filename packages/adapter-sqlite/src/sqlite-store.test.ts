import {
  buildEntity,
  canonicalStoreComplianceTests,
  compactProvenance,
  decisionLifecycleStoreComplianceTests,
  localStandaloneMetadata,
  localStandalonePrincipal,
} from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { createSqliteCanonicalStore } from './sqlite-store.js';

const factory = () => createSqliteCanonicalStore(':memory:');

canonicalStoreComplianceTests(factory);
decisionLifecycleStoreComplianceTests(factory);

describe('SQLite entity catalog', () => {
  it('lists entities by tenant and namespace without requiring claims', async () => {
    const store = factory();
    const principal = localStandalonePrincipal();
    const metadata = localStandaloneMetadata(principal.id);
    const entity = buildEntity({
      metadata,
      labels: ['Unreferenced SQLite entity'],
      provenance: compactProvenance({
        source: 'test',
        actor: principal.id,
        process: 'sqlite-list-entities',
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
