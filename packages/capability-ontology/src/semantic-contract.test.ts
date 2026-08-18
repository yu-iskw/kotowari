import { describe, expect, it } from 'vitest';

import { semanticContractJsonLdContext } from './json-ld.js';
import { semanticContractJsonSchema } from './json-schema.js';
import {
  resolveEntityType,
  resolvePredicate,
  validateSemanticContract,
} from './semantic-contract.js';

import type { SemanticContract } from './semantic-contract.js';

const CONTRACT: SemanticContract = {
  id: 'people',
  name: 'People vocabulary',
  version: 1,
  status: 'active',
  baseIri: 'https://example.com/vocab/',
  prefixes: { ex: 'https://example.com/vocab/' },
  entityTypes: [
    { id: 'Person', aliases: ['person'], closed: true },
    { id: 'Employee', extends: ['Person'], aliases: ['employee'], closed: true },
    { id: 'Organization', aliases: ['org'] },
  ],
  predicates: [
    {
      id: 'name',
      aliases: ['fullName'],
      domain: ['Person'],
      range: { kind: 'literal', datatype: 'string' },
      cardinality: { min: 1, max: 1 },
      rules: [{ kind: 'min-length', value: 1 }],
    },
    {
      id: 'age',
      domain: ['Person'],
      range: { kind: 'literal', datatype: 'integer' },
      cardinality: { max: 1 },
    },
    {
      id: 'worksFor',
      domain: ['Person'],
      range: { kind: 'entity', entityTypeIds: ['Organization'] },
      cardinality: { max: 1 },
    },
  ],
};

describe('semantic contracts', () => {
  it('validates and resolves canonical terms and aliases', () => {
    expect(validateSemanticContract(CONTRACT)).toEqual([]);
    expect(resolveEntityType(CONTRACT, 'employee')?.id).toBe('Employee');
    expect(resolvePredicate(CONTRACT, 'fullName')?.id).toBe('name');
  });

  it('detects broken references, cycles, and constraints', () => {
    const invalid: SemanticContract = {
      ...CONTRACT,
      entityTypes: [
        { id: 'Person', extends: ['Employee'], aliases: ['shared'] },
        { id: 'Employee', extends: ['Person'], aliases: ['shared'] },
      ],
      predicates: [
        {
          id: 'manager',
          domain: ['Missing'],
          range: { kind: 'entity', entityTypeIds: ['Missing'] },
          cardinality: { min: 2, max: 1 },
          rules: [{ kind: 'pattern', pattern: '[' }],
        },
      ],
    };
    const codes = new Set(validateSemanticContract(invalid).map((issue) => issue.code));
    expect(codes).toEqual(
      new Set([
        'DUPLICATE_ALIAS',
        'UNKNOWN_DOMAIN_ENTITY_TYPE',
        'UNKNOWN_RANGE_ENTITY_TYPE',
        'ENTITY_TYPE_CYCLE',
        'INVALID_CARDINALITY',
        'INVALID_PATTERN',
      ]),
    );
  });

  it('derives inherited JSON Schema constraints', () => {
    const schema = semanticContractJsonSchema(CONTRACT, 'Employee');
    expect(schema['$schema']).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(schema['additionalProperties']).toBe(false);
    expect(schema['required']).toEqual(['@type', 'name']);
    expect(schema['properties']).toMatchObject({
      '@type': { const: 'https://example.com/vocab/Employee' },
      name: { type: 'string', minLength: 1 },
      age: { type: 'integer' },
      worksFor: { type: 'string' },
    });
  });

  it('derives a JSON-LD 1.1 context with entity coercion', () => {
    const context = semanticContractJsonLdContext(CONTRACT)['@context'];
    expect(context['@version']).toBe(1.1);
    expect(context['Person']).toBe('https://example.com/vocab/Person');
    expect(context['worksFor']).toEqual({
      '@id': 'https://example.com/vocab/worksFor',
      '@type': '@id',
    });
    expect(context['age']).toEqual({
      '@id': 'https://example.com/vocab/age',
      '@type': 'http://www.w3.org/2001/XMLSchema#integer',
    });
  });
});
