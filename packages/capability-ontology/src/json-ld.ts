import { entityTypeIri, predicateIri } from './semantic-contract.js';

import type { LiteralDatatype, PredicateDefinition, SemanticContract } from './semantic-contract.js';

export type JsonLdContextDocument = {
  '@context': Readonly<Record<string, unknown>>;
};

const XSD = 'http://www.w3.org/2001/XMLSchema#';

function datatypeIri(datatype: LiteralDatatype): string | undefined {
  switch (datatype) {
    case 'string':
      return `${XSD}string`;
    case 'integer':
      return `${XSD}integer`;
    case 'number':
      return `${XSD}double`;
    case 'boolean':
      return `${XSD}boolean`;
    case 'date':
      return `${XSD}date`;
    case 'date-time':
      return `${XSD}dateTime`;
    case 'uri':
      return undefined;
  }
}

function predicateContextValue(
  contract: SemanticContract,
  predicate: PredicateDefinition,
): string | Readonly<Record<string, string>> {
  const iri = predicateIri(contract, predicate);
  if (predicate.range.kind === 'entity' || predicate.range.datatype === 'uri') {
    return { '@id': iri, '@type': '@id' };
  }
  const type = predicate.range.datatypeIri ?? datatypeIri(predicate.range.datatype);
  return type === undefined ? iri : { '@id': iri, '@type': type };
}

export function semanticContractJsonLdContext(contract: SemanticContract): JsonLdContextDocument {
  const prefixes = Object.fromEntries(
    Object.entries(contract.prefixes ?? {}).map(([prefix, iri]) => [prefix, { '@id': iri, '@prefix': true }]),
  );
  const entityTypes = Object.fromEntries(
    contract.entityTypes.map((entityType) => [entityType.id, entityTypeIri(contract, entityType)]),
  );
  const predicates = Object.fromEntries(
    contract.predicates.map((predicate) => [predicate.id, predicateContextValue(contract, predicate)]),
  );
  return {
    '@context': {
      '@version': 1.1,
      '@vocab': contract.baseIri,
      ...prefixes,
      ...entityTypes,
      ...predicates,
    },
  };
}
