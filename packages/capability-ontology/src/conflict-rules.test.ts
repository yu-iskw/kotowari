import { describe, expect, it } from 'vitest';

import { semanticContractConflictRules } from './conflict-rules.js';

import type { SemanticContract } from './semantic-contract.js';

function contract(status: SemanticContract['status'] = 'active'): SemanticContract {
  return {
    id: 'crm',
    name: 'CRM',
    version: 3,
    status,
    baseIri: 'https://example.com/',
    entityTypes: [],
    predicates: [
      {
        id: 'legalName',
        iri: 'https://example.com/legal-name',
        aliases: ['name'],
        range: { kind: 'literal', datatype: 'string' },
        cardinality: { max: 1 },
      },
      {
        id: 'director',
        range: { kind: 'entity' },
        cardinality: { max: 3 },
      },
      {
        id: 'tag',
        range: { kind: 'literal', datatype: 'string' },
      },
    ],
  };
}

describe('semanticContractConflictRules', () => {
  it('translates active max-cardinality constraints with all semantic terms', () => {
    const rules = semanticContractConflictRules(contract());

    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({
      kind: 'max-cardinality',
      predicate: 'legalName',
      terms: ['https://example.com/legal-name', 'legalName', 'name'],
      max: 1,
      source: 'semantic-contract:crm@3',
    });
    expect(rules[1]?.max).toBe(3);
  });

  it('does not enforce draft contracts', () => {
    expect(semanticContractConflictRules(contract('draft'))).toEqual([]);
  });
});
