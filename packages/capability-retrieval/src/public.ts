export const PACKAGE_NAME = '@kotowari/capability-retrieval' as const;

export { CapabilityRetrievalError } from './errors.js';
export type { CapabilityRetrievalContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { evaluateRetrieval } from './evaluation.js';
export type { RetrievalEvaluationCase, RetrievalEvaluationMetrics } from './evaluation.js';
export { DEFAULT_RRF_K, reciprocalRankFuse } from './fusion.js';
export type { FusedCandidate, RankedCandidateList } from './fusion.js';
export { DEFAULT_RETRIEVAL_PLAN, RETRIEVAL_PLAN_VERSION, retrieve } from './retrieve.js';
export type {
  RetrievalHit,
  RetrievalOmission,
  RetrievalPlan,
  RetrievalResult,
} from './retrieve.js';
