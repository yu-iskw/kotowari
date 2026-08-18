import { entityTypeIri, predicateIri, resolveEntityType } from './semantic-contract.js';

import type {
  EntityTypeDefinition,
  PredicateDefinition,
  SemanticContract,
  ValidationRule,
} from './semantic-contract.js';

export type JsonSchemaDocument = Readonly<Record<string, unknown>>;

const JSON_SCHEMA_DRAFT = 'https://json-schema.org/draft/2020-12/schema';

function entityTypeClosure(
  contract: SemanticContract,
  entityType: EntityTypeDefinition,
): ReadonlySet<string> {
  const values = new Set<string>([entityType.id]);
  const visit = (id: string): void => {
    const current = resolveEntityType(contract, id);
    for (const parent of current?.extends ?? []) {
      if (!values.has(parent)) {
        values.add(parent);
        visit(parent);
      }
    }
  };
  visit(entityType.id);
  return values;
}

function appliesToEntityType(
  predicate: PredicateDefinition,
  entityTypeIds: ReadonlySet<string>,
): boolean {
  const domain = predicate.domain ?? [];
  return domain.length === 0 || domain.some((id) => entityTypeIds.has(id));
}

function literalSchema(predicate: PredicateDefinition): Record<string, unknown> {
  if (predicate.range.kind !== 'literal') {
    return { type: 'string' };
  }
  const schema: Record<string, unknown> = {};
  switch (predicate.range.datatype) {
    case 'integer':
      schema['type'] = 'integer';
      break;
    case 'number':
      schema['type'] = 'number';
      break;
    case 'boolean':
      schema['type'] = 'boolean';
      break;
    case 'date':
      schema['type'] = 'string';
      schema['format'] = 'date';
      break;
    case 'date-time':
      schema['type'] = 'string';
      schema['format'] = 'date-time';
      break;
    case 'uri':
      schema['type'] = 'string';
      schema['format'] = 'uri';
      break;
    case 'string':
      schema['type'] = 'string';
      break;
  }
  for (const rule of predicate.rules ?? []) {
    applyRule(schema, rule);
  }
  return schema;
}

function applyRule(schema: Record<string, unknown>, rule: ValidationRule): void {
  switch (rule.kind) {
    case 'enum':
      schema['enum'] = [...rule.values];
      break;
    case 'pattern':
      schema['pattern'] = rule.pattern;
      break;
    case 'min-length':
      schema['minLength'] = rule.value;
      break;
    case 'max-length':
      schema['maxLength'] = rule.value;
      break;
  }
}

function scalarPredicateSchema(predicate: PredicateDefinition): Record<string, unknown> {
  if (predicate.range.kind === 'entity') {
    return {
      type: 'string',
      ...(predicate.description === undefined ? {} : { description: predicate.description }),
    };
  }
  return {
    ...literalSchema(predicate),
    ...(predicate.description === undefined ? {} : { description: predicate.description }),
  };
}

function predicateSchema(predicate: PredicateDefinition): Record<string, unknown> {
  const scalar = scalarPredicateSchema(predicate);
  if (predicate.cardinality?.max === 1) {
    return scalar;
  }
  return {
    type: 'array',
    items: scalar,
    ...(predicate.cardinality?.min === undefined ? {} : { minItems: predicate.cardinality.min }),
    ...(predicate.cardinality?.max === undefined ? {} : { maxItems: predicate.cardinality.max }),
  };
}

export function semanticContractJsonSchema(
  contract: SemanticContract,
  entityTypeTerm: string,
): JsonSchemaDocument {
  const entityType = resolveEntityType(contract, entityTypeTerm);
  if (entityType === undefined) {
    throw new Error(`Unknown entity type: ${entityTypeTerm}`);
  }
  const closure = entityTypeClosure(contract, entityType);
  const predicates = contract.predicates.filter((predicate) => appliesToEntityType(predicate, closure));
  const properties = Object.fromEntries(
    predicates.map((predicate) => [predicate.id, predicateSchema(predicate)]),
  );
  const requiredPredicates = predicates
    .filter((predicate) => (predicate.cardinality?.min ?? 0) > 0)
    .map((predicate) => predicate.id);
  const typeIri = entityTypeIri(contract, entityType);
  return {
    $schema: JSON_SCHEMA_DRAFT,
    $id: `${typeIri}.schema.json`,
    title: entityType.label ?? entityType.id,
    ...(entityType.description === undefined ? {} : { description: entityType.description }),
    type: 'object',
    properties: {
      '@id': { type: 'string', format: 'uri' },
      '@type': { const: typeIri },
      ...properties,
    },
    required: ['@type', ...requiredPredicates],
    additionalProperties: entityType.closed !== true,
    $comment: `Generated from ${contract.id}@${String(contract.version)}; predicate IRIs are available in the JSON-LD context.`,
  };
}

export function semanticContractJsonSchemas(
  contract: SemanticContract,
): Readonly<Record<string, JsonSchemaDocument>> {
  return Object.fromEntries(
    contract.entityTypes.map((entityType) => [
      entityType.id,
      semanticContractJsonSchema(contract, entityType.id),
    ]),
  );
}

export function semanticContractPredicateIris(
  contract: SemanticContract,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    contract.predicates.map((predicate) => [predicate.id, predicateIri(contract, predicate)]),
  );
}
