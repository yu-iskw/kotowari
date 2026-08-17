export const PACKAGE_NAME = '@kotowari/capability-retrieval' as const;

export { CapabilityRetrievalError } from './errors.js';
export type { CapabilityRetrievalContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { DEFAULT_RETRIEVAL_PLAN, retrieve } from './retrieve.js';
export type {
  RetrievalHit,
  RetrievalOmission,
  RetrievalPlan,
  RetrievalResult,
} from './retrieve.js';
