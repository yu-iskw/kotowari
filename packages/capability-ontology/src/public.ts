export const PACKAGE_NAME = '@kotowari/capability-ontology' as const;

export { validateClaimAgainstContract } from './claim-validation.js';
export type {
  ClaimContractContext,
  ClaimContractIssue,
  ClaimContractIssueCode,
} from './claim-validation.js';
export { semanticContractConflictRules } from './conflict-rules.js';
export { CapabilityOntologyError } from './errors.js';
export type { CapabilityOntologyContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { semanticContractJsonLdContext } from './json-ld.js';
export type { JsonLdContextDocument } from './json-ld.js';
export {
  semanticContractJsonSchema,
  semanticContractJsonSchemas,
  semanticContractPredicateIris,
} from './json-schema.js';
export type { JsonSchemaDocument } from './json-schema.js';
export { uniquePredicates } from './ontology.js';
export {
  createInMemorySemanticContractRegistry,
  latestActiveSemanticContract,
  semanticContractKey,
} from './registry.js';
export type { SemanticContractFilter, SemanticContractRegistry } from './registry.js';
export {
  LITERAL_DATATYPES,
  SEMANTIC_CONTRACT_STATUSES,
  entityTypeIri,
  predicateIri,
  resolveEntityType,
  resolvePredicate,
  validateSemanticContract,
} from './semantic-contract.js';
export type {
  Cardinality,
  EntityTypeDefinition,
  LiteralDatatype,
  PredicateDefinition,
  PredicateRange,
  SemanticContract,
  SemanticContractIssue,
  SemanticContractIssueCode,
  SemanticContractStatus,
  ValidationRule,
} from './semantic-contract.js';
