export const PACKAGE_NAME = '@kotowari/capability-knowledge' as const;

export { CapabilityKnowledgeError } from './errors.js';
export type { CapabilityKnowledgeContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { resolveClaimConflict } from './conflicts.js';
export {
  ENTITY_RESOLVER_VERSION,
  decideEntityResolutionProposal,
  findEntityResolutionCandidates,
  findEntityResolutionCandidatesForEntity,
  listEntityMergeLineage,
  mergeApprovedEntityResolution,
  normalizeEntityName,
  recordEntityResolutionProposal,
  resolveCanonicalEntity,
  revertEntityMerge,
} from './entity-resolution.js';
export type { EntityResolutionCandidate } from './entity-resolution.js';
export {
  activeEntityMergeEvents,
  canonicalEntityIdFromEvents,
  createEventBackedEntityResolutionStore,
} from './entity-resolution-store.js';
export type { EntityResolutionFilter, EntityResolutionStore } from './entity-resolution-store.js';
