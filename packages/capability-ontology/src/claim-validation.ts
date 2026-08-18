import { resolvePredicate } from './semantic-contract.js';

import type {
  LiteralDatatype,
  PredicateDefinition,
  SemanticContract,
  ValidationRule,
} from './semantic-contract.js';
import type { Claim } from '@kotowari/kernel';

export type ClaimContractIssueCode =
  | 'UNKNOWN_PREDICATE'
  | 'DOMAIN_MISMATCH'
  | 'RANGE_KIND_MISMATCH'
  | 'RANGE_ENTITY_TYPE_MISMATCH'
  | 'DATATYPE_MISMATCH'
  | 'VALUE_RULE_VIOLATION';

export type ClaimContractIssue = {
  code: ClaimContractIssueCode;
  path: string;
  message: string;
};

export type ClaimContractContext = {
  subjectEntityTypeIds?: readonly string[];
  objectEntityTypeIds?: readonly string[];
};

function hasIntersection(left: readonly string[], right: readonly string[]): boolean {
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

function literalMatchesDatatype(value: string, datatype: LiteralDatatype): boolean {
  switch (datatype) {
    case 'string':
      return true;
    case 'integer':
      return /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value));
    case 'number':
      return value.trim() !== '' && Number.isFinite(Number(value));
    case 'boolean':
      return value === 'true' || value === 'false';
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
    case 'date-time':
      return !Number.isNaN(Date.parse(value));
    case 'uri':
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
  }
}

function ruleMatches(value: string, rule: ValidationRule): boolean {
  switch (rule.kind) {
    case 'enum':
      return rule.values.includes(value);
    case 'pattern':
      return new RegExp(rule.pattern).test(value);
    case 'min-length':
      return value.length >= rule.value;
    case 'max-length':
      return value.length <= rule.value;
  }
}

function literalIssues(
  claim: Claim,
  predicate: PredicateDefinition,
): readonly ClaimContractIssue[] {
  if (predicate.range.kind !== 'literal' || claim.object.kind !== 'literal') {
    return [];
  }
  const issues: ClaimContractIssue[] = [];
  if (!literalMatchesDatatype(claim.object.value, predicate.range.datatype)) {
    issues.push({
      code: 'DATATYPE_MISMATCH',
      path: 'object.value',
      message: `Value does not match ${predicate.range.datatype}: ${predicate.id}`,
    });
  }
  if (
    predicate.range.datatypeIri !== undefined &&
    claim.object.datatype !== undefined &&
    claim.object.datatype !== predicate.range.datatypeIri
  ) {
    issues.push({
      code: 'DATATYPE_MISMATCH',
      path: 'object.datatype',
      message: `Literal datatype IRI does not match predicate contract: ${predicate.id}`,
    });
  }
  for (const rule of predicate.rules ?? []) {
    if (!ruleMatches(claim.object.value, rule)) {
      issues.push({
        code: 'VALUE_RULE_VIOLATION',
        path: 'object.value',
        message: `Literal value violates ${rule.kind} rule: ${predicate.id}`,
      });
    }
  }
  return issues;
}

function domainIssues(
  predicate: PredicateDefinition,
  context: ClaimContractContext,
): readonly ClaimContractIssue[] {
  const domain = predicate.domain ?? [];
  const subjectTypes = context.subjectEntityTypeIds ?? [];
  if (domain.length === 0 || subjectTypes.length === 0 || hasIntersection(domain, subjectTypes)) {
    return [];
  }
  return [
    {
      code: 'DOMAIN_MISMATCH',
      path: 'subject',
      message: `Subject entity type is outside predicate domain: ${predicate.id}`,
    },
  ];
}

function entityRangeIssues(
  claim: Claim,
  predicate: PredicateDefinition,
  context: ClaimContractContext,
): readonly ClaimContractIssue[] {
  if (predicate.range.kind !== 'entity' || claim.object.kind !== 'entity') {
    return [];
  }
  const expected = predicate.range.entityTypeIds ?? [];
  const actual = context.objectEntityTypeIds ?? [];
  if (expected.length === 0 || actual.length === 0 || hasIntersection(expected, actual)) {
    return [];
  }
  return [
    {
      code: 'RANGE_ENTITY_TYPE_MISMATCH',
      path: 'object.entityId',
      message: `Object entity type is outside predicate range: ${predicate.id}`,
    },
  ];
}

export function validateClaimAgainstContract(
  claim: Claim,
  contract: SemanticContract,
  context: ClaimContractContext = {},
): readonly ClaimContractIssue[] {
  const predicate = resolvePredicate(contract, claim.predicate);
  if (predicate === undefined) {
    return [
      {
        code: 'UNKNOWN_PREDICATE',
        path: 'predicate',
        message: `Predicate is not defined by semantic contract: ${claim.predicate}`,
      },
    ];
  }
  if (predicate.range.kind !== claim.object.kind) {
    return [
      ...domainIssues(predicate, context),
      {
        code: 'RANGE_KIND_MISMATCH',
        path: 'object',
        message: `Claim object kind does not match predicate range: ${predicate.id}`,
      },
    ];
  }
  return [
    ...domainIssues(predicate, context),
    ...entityRangeIssues(claim, predicate, context),
    ...literalIssues(claim, predicate),
  ];
}
