import { describe, expect, it } from 'vitest';

import {
  asIsoTimestamp,
  asPrincipalId,
  buildClaimAsserted,
  compactProvenance,
  localStandaloneMetadata,
  newId,
} from '@kotowari/kernel';

import { validateClaimAgainstContract } from './claim-validation.js';

import type { ClaimObject } from '@kotowari/kernel';
import type { SemanticContract } from './semantic-contract.js';

const CONTRACT: SemanticContract = {
  id: 'people',
  name: 'People vocabulary',
  version: 1,
  status: 'active',
  baseIri: 'https://example.com/vocab/',
  entityTypes: [{ id: 'Person' }, { id: 'Organization' }],
  predicates: [
    {
      id: 'age',
      aliases: ['ageYears'],
      domain: ['Person'],
      range: { kind: 'literal', datatype: 'integer' },
      cardinality: { max: 1 },
    },
    {
      id: 'email',
      domain: ['Person'],
      range: { kind: 'literal', datatype: 'string' },
      cardinality: { max: 1 },
      rules: [{ kind: 'pattern', pattern: '^[^@]+@[^@]+$' }],
    },
    {
      id: 'worksFor',
      domain: ['Person'],
      range: { kind: 'entity', entityTypeIds: ['Organization'] },
      cardinality: { max: 1 },
    },
  ],
};

function claim(predicate: string, object: ClaimObject) {
  const timestamp = asIsoTimestamp('2026-08-18T00:00:00.000Z');
  return buildClaimAsserted({
    metadata: localStandaloneMetadata(asPrincipalId('tester')),
    subject: newId('EntityId'),
    predicate,
    object,
    validFrom: timestamp,
    assertedAt: timestamp,
    confidence: 1,
    evidenceIds: [newId('EvidenceId')],
    provenance: compactProvenance({
      source: 'semantic-contract-test',
      actor: asPrincipalId('tester'),
      process: 'validate-claim',
    }),
  }).claim;
}

describe('validateClaimAgainstContract', () => {
  it('accepts canonical predicates and aliases', () => {
    expect(
      validateClaimAgainstContract(
        claim('ageYears', { kind: 'literal', value: '42' }),
        CONTRACT,
        { subjectEntityTypeIds: ['Person'] },
      ),
    ).toEqual([]);
  });

  it('reports unknown predicates and domain mismatches', () => {
    expect(validateClaimAgainstContract(claim('missing', { kind: 'literal', value: 'x' }), CONTRACT))
      .toMatchObject([{ code: 'UNKNOWN_PREDICATE' }]);
    expect(
      validateClaimAgainstContract(claim('age', { kind: 'literal', value: '42' }), CONTRACT, {
        subjectEntityTypeIds: ['Organization'],
      }),
    ).toMatchObject([{ code: 'DOMAIN_MISMATCH' }]);
  });

  it('validates literal datatypes and value rules', () => {
    expect(
      validateClaimAgainstContract(claim('age', { kind: 'literal', value: 'forty-two' }), CONTRACT),
    ).toMatchObject([{ code: 'DATATYPE_MISMATCH' }]);
    expect(
      validateClaimAgainstContract(
        claim('email', { kind: 'literal', value: 'invalid-email' }),
        CONTRACT,
      ),
    ).toMatchObject([{ code: 'VALUE_RULE_VIOLATION' }]);
  });

  it('validates entity ranges when object types are known', () => {
    expect(
      validateClaimAgainstContract(
        claim('worksFor', { kind: 'entity', entityId: newId('EntityId') }),
        CONTRACT,
        { subjectEntityTypeIds: ['Person'], objectEntityTypeIds: ['Person'] },
      ),
    ).toMatchObject([{ code: 'RANGE_ENTITY_TYPE_MISMATCH' }]);
  });
});
