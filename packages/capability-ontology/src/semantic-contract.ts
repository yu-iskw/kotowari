export const SEMANTIC_CONTRACT_STATUSES = ['draft', 'active', 'retired'] as const;
export type SemanticContractStatus = (typeof SEMANTIC_CONTRACT_STATUSES)[number];

export const LITERAL_DATATYPES = [
  'string',
  'integer',
  'number',
  'boolean',
  'date',
  'date-time',
  'uri',
] as const;
export type LiteralDatatype = (typeof LITERAL_DATATYPES)[number];

export type ValidationRule =
  | { kind: 'enum'; values: readonly string[] }
  | { kind: 'pattern'; pattern: string }
  | { kind: 'min-length'; value: number }
  | { kind: 'max-length'; value: number };

export type PredicateRange =
  | {
      kind: 'literal';
      datatype: LiteralDatatype;
      datatypeIri?: string;
    }
  | {
      kind: 'entity';
      entityTypeIds?: readonly string[];
    };

export type Cardinality = {
  min?: number;
  max?: number;
};

export type EntityTypeDefinition = {
  id: string;
  iri?: string;
  label?: string;
  description?: string;
  aliases?: readonly string[];
  extends?: readonly string[];
  closed?: boolean;
};

export type PredicateDefinition = {
  id: string;
  iri?: string;
  label?: string;
  description?: string;
  aliases?: readonly string[];
  domain?: readonly string[];
  range: PredicateRange;
  cardinality?: Cardinality;
  rules?: readonly ValidationRule[];
};

export type SemanticContract = {
  id: string;
  name: string;
  version: number;
  status: SemanticContractStatus;
  baseIri: string;
  prefixes?: Readonly<Record<string, string>>;
  entityTypes: readonly EntityTypeDefinition[];
  predicates: readonly PredicateDefinition[];
};

export type SemanticContractIssueCode =
  | 'DUPLICATE_ENTITY_TYPE_ID'
  | 'DUPLICATE_ENTITY_TYPE_IRI'
  | 'DUPLICATE_PREDICATE_ID'
  | 'DUPLICATE_PREDICATE_IRI'
  | 'DUPLICATE_ALIAS'
  | 'UNKNOWN_PARENT_ENTITY_TYPE'
  | 'ENTITY_TYPE_CYCLE'
  | 'UNKNOWN_DOMAIN_ENTITY_TYPE'
  | 'UNKNOWN_RANGE_ENTITY_TYPE'
  | 'INVALID_CARDINALITY'
  | 'INVALID_PATTERN'
  | 'INVALID_RULE';

export type SemanticContractIssue = {
  code: SemanticContractIssueCode;
  path: string;
  message: string;
};

function duplicates(values: readonly (string | undefined)[]): readonly string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (value === undefined) {
      continue;
    }
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated].sort((left, right) => left.localeCompare(right));
}

function duplicateIssues(
  values: readonly (string | undefined)[],
  code: SemanticContractIssueCode,
  path: string,
  label: string,
): readonly SemanticContractIssue[] {
  return duplicates(values).map((value) => ({
    code,
    path,
    message: `${label} must be unique: ${value}`,
  }));
}

function entityTypeReferenceIssues(contract: SemanticContract): readonly SemanticContractIssue[] {
  const known = new Set(contract.entityTypes.map((item) => item.id));
  const issues: SemanticContractIssue[] = [];
  for (const [index, entityType] of contract.entityTypes.entries()) {
    for (const parent of entityType.extends ?? []) {
      if (!known.has(parent)) {
        issues.push({
          code: 'UNKNOWN_PARENT_ENTITY_TYPE',
          path: `entityTypes[${String(index)}].extends`,
          message: `Unknown parent entity type: ${parent}`,
        });
      }
    }
  }
  for (const [index, predicate] of contract.predicates.entries()) {
    for (const entityTypeId of predicate.domain ?? []) {
      if (!known.has(entityTypeId)) {
        issues.push({
          code: 'UNKNOWN_DOMAIN_ENTITY_TYPE',
          path: `predicates[${String(index)}].domain`,
          message: `Unknown domain entity type: ${entityTypeId}`,
        });
      }
    }
    if (predicate.range.kind === 'entity') {
      for (const entityTypeId of predicate.range.entityTypeIds ?? []) {
        if (!known.has(entityTypeId)) {
          issues.push({
            code: 'UNKNOWN_RANGE_ENTITY_TYPE',
            path: `predicates[${String(index)}].range.entityTypeIds`,
            message: `Unknown range entity type: ${entityTypeId}`,
          });
        }
      }
    }
  }
  return issues;
}

function entityTypeCycleIssues(contract: SemanticContract): readonly SemanticContractIssue[] {
  const parents = new Map(contract.entityTypes.map((item) => [item.id, item.extends ?? []] as const));
  const issues: SemanticContractIssue[] = [];
  for (const entityType of contract.entityTypes) {
    const visiting = new Set<string>();
    let found = false;
    const visit = (id: string): void => {
      if (found) {
        return;
      }
      if (visiting.has(id)) {
        found = true;
        return;
      }
      visiting.add(id);
      for (const parent of parents.get(id) ?? []) {
        visit(parent);
      }
      visiting.delete(id);
    };
    visit(entityType.id);
    if (found) {
      issues.push({
        code: 'ENTITY_TYPE_CYCLE',
        path: `entityTypes.${entityType.id}.extends`,
        message: `Entity type inheritance must be acyclic: ${entityType.id}`,
      });
    }
  }
  return issues;
}

function predicateConstraintIssues(contract: SemanticContract): readonly SemanticContractIssue[] {
  const issues: SemanticContractIssue[] = [];
  for (const [index, predicate] of contract.predicates.entries()) {
    const min = predicate.cardinality?.min ?? 0;
    const max = predicate.cardinality?.max;
    if (min < 0 || !Number.isInteger(min) || (max !== undefined && (max < min || !Number.isInteger(max)))) {
      issues.push({
        code: 'INVALID_CARDINALITY',
        path: `predicates[${String(index)}].cardinality`,
        message: `Invalid cardinality for predicate: ${predicate.id}`,
      });
    }
    for (const [ruleIndex, rule] of (predicate.rules ?? []).entries()) {
      if (rule.kind === 'pattern') {
        try {
          new RegExp(rule.pattern);
        } catch {
          issues.push({
            code: 'INVALID_PATTERN',
            path: `predicates[${String(index)}].rules[${String(ruleIndex)}]`,
            message: `Invalid regular expression for predicate: ${predicate.id}`,
          });
        }
      }
      if (
        (rule.kind === 'min-length' || rule.kind === 'max-length') &&
        (rule.value < 0 || !Number.isInteger(rule.value))
      ) {
        issues.push({
          code: 'INVALID_RULE',
          path: `predicates[${String(index)}].rules[${String(ruleIndex)}]`,
          message: `Length constraints must be non-negative integers: ${predicate.id}`,
        });
      }
    }
  }
  return issues;
}

function aliasIssues(contract: SemanticContract): readonly SemanticContractIssue[] {
  const aliases = [
    ...contract.entityTypes.flatMap((item) => item.aliases ?? []),
    ...contract.predicates.flatMap((item) => item.aliases ?? []),
  ];
  return duplicateIssues(aliases, 'DUPLICATE_ALIAS', 'aliases', 'Aliases');
}

export function validateSemanticContract(contract: SemanticContract): readonly SemanticContractIssue[] {
  return [
    ...duplicateIssues(
      contract.entityTypes.map((item) => item.id),
      'DUPLICATE_ENTITY_TYPE_ID',
      'entityTypes',
      'Entity type IDs',
    ),
    ...duplicateIssues(
      contract.entityTypes.map((item) => item.iri),
      'DUPLICATE_ENTITY_TYPE_IRI',
      'entityTypes',
      'Entity type IRIs',
    ),
    ...duplicateIssues(
      contract.predicates.map((item) => item.id),
      'DUPLICATE_PREDICATE_ID',
      'predicates',
      'Predicate IDs',
    ),
    ...duplicateIssues(
      contract.predicates.map((item) => item.iri),
      'DUPLICATE_PREDICATE_IRI',
      'predicates',
      'Predicate IRIs',
    ),
    ...aliasIssues(contract),
    ...entityTypeReferenceIssues(contract),
    ...entityTypeCycleIssues(contract),
    ...predicateConstraintIssues(contract),
  ];
}

function semanticTerms<T extends { id: string; iri?: string; aliases?: readonly string[] }>(
  items: readonly T[],
): ReadonlyMap<string, T> {
  const terms = new Map<string, T>();
  for (const item of items) {
    for (const term of [item.id, item.iri, ...(item.aliases ?? [])]) {
      if (term !== undefined && !terms.has(term)) {
        terms.set(term, item);
      }
    }
  }
  return terms;
}

export function resolveEntityType(
  contract: SemanticContract,
  term: string,
): EntityTypeDefinition | undefined {
  return semanticTerms(contract.entityTypes).get(term);
}

export function resolvePredicate(
  contract: SemanticContract,
  term: string,
): PredicateDefinition | undefined {
  return semanticTerms(contract.predicates).get(term);
}

export function predicateIri(contract: SemanticContract, predicate: PredicateDefinition): string {
  return predicate.iri ?? new URL(predicate.id, contract.baseIri).toString();
}

export function entityTypeIri(contract: SemanticContract, entityType: EntityTypeDefinition): string {
  return entityType.iri ?? new URL(entityType.id, contract.baseIri).toString();
}
