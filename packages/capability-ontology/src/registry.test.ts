import { describe, expect, it } from 'vitest';

import {
  createInMemorySemanticContractRegistry,
  latestActiveSemanticContract,
} from './registry.js';

import type { SemanticContract } from './semantic-contract.js';

function contract(
  version: number,
  status: SemanticContract['status'] = 'active',
): SemanticContract {
  return {
    id: 'people',
    name: 'People vocabulary',
    version,
    status,
    baseIri: 'https://example.com/vocab/',
    entityTypes: [{ id: 'Person' }],
    predicates: [
      {
        id: 'name',
        domain: ['Person'],
        range: { kind: 'literal', datatype: 'string' },
        cardinality: { max: 1 },
      },
    ],
  };
}

describe('SemanticContractRegistry', () => {
  it('stores immutable versions and finds the latest active version', async () => {
    const registry = createInMemorySemanticContractRegistry();
    await registry.put(contract(1));
    await registry.put(contract(2, 'retired'));
    await registry.put(contract(3));

    expect((await registry.list({ id: 'people' })).map((item) => item.version)).toEqual([1, 2, 3]);
    expect((await latestActiveSemanticContract(registry, 'people'))?.version).toBe(3);
  });

  it('allows idempotent writes but rejects mutation of an existing version', async () => {
    const registry = createInMemorySemanticContractRegistry();
    const first = contract(1);
    await registry.put(first);
    await expect(registry.put(first)).resolves.toBeUndefined();
    await expect(registry.put({ ...first, name: 'Changed' })).rejects.toThrow(
      'Semantic contract versions are immutable',
    );
  });

  it('rejects invalid contracts before registration', async () => {
    const registry = createInMemorySemanticContractRegistry();
    await expect(
      registry.put({
        ...contract(1),
        predicates: [
          {
            id: 'name',
            domain: ['Missing'],
            range: { kind: 'literal', datatype: 'string' },
          },
        ],
      }),
    ).rejects.toThrow('Invalid semantic contract');
  });
});
