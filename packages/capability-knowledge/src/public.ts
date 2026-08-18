export const PACKAGE_NAME = '@kotowari/capability-knowledge' as const;

export { CapabilityKnowledgeError } from './errors.js';
export type { CapabilityKnowledgeContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { resolveClaimConflict } from './conflicts.js';
export { findEntityResolutionCandidates } from './entity-resolution.js';
export type { EntityResolutionCandidate } from './entity-resolution.js';
