import type { CardinalityConflictRule } from '@kotowari/kernel';

import { CapabilityOntologyError } from './errors.js';
import { validateSemanticContract } from './semantic-contract.js';

import type { SemanticContract } from './semantic-contract.js';

export function semanticContractConflictRules(
  contract: SemanticContract,
): readonly CardinalityConflictRule[] {
  if (contract.status !== 'active') {
    return [];
  }
  const issues = validateSemanticContract(contract);
  if (issues.length > 0) {
    throw new CapabilityOntologyError(
      `Invalid semantic contract: ${issues.map((issue) => issue.code).join(', ')}`,
    );
  }
  const source = `semantic-contract:${contract.id}@${String(contract.version)}`;
  return contract.predicates.flatMap((predicate) => {
    const max = predicate.cardinality?.max;
    if (max === undefined || max < 1) {
      return [];
    }
    const terms = [...new Set([predicate.id, predicate.iri, ...(predicate.aliases ?? [])])]
      .filter((term): term is string => term !== undefined)
      .sort((left, right) => left.localeCompare(right));
    return [
      {
        kind: 'max-cardinality' as const,
        predicate: predicate.id,
        terms,
        max,
        source,
      },
    ];
  });
}
