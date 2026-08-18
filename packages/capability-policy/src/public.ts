export const PACKAGE_NAME = '@kotowari/capability-policy' as const;

export { CapabilityPolicyError } from './errors.js';
export type { CapabilityPolicyContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export {
  evaluateDecisionAgainstPolicy,
  isPolicyApplicable,
  policyVersionKey,
  policyVersionRef,
  putPolicy,
  putPolicyVersion,
  selectApplicablePolicies,
  whatIfPolicy,
} from './policy.js';
