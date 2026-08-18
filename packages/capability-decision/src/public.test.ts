import { describe, expect, it } from 'vitest';

import {
  buildDecisionAuditBundleCapability,
  createApprovalRecord,
  createDecisionRelation,
  createOutcomeObservation,
  createPolicyException,
  findDecisionPrecedentsCapability,
  recordDecisionCapability,
  replayDecisionCapability,
} from './public.js';

describe('public', () => {
  it('exports the decision accountability capability surface', () => {
    expect(recordDecisionCapability).toBeTypeOf('function');
    expect(replayDecisionCapability).toBeTypeOf('function');
    expect(findDecisionPrecedentsCapability).toBeTypeOf('function');
    expect(buildDecisionAuditBundleCapability).toBeTypeOf('function');
    expect(createDecisionRelation).toBeTypeOf('function');
    expect(createOutcomeObservation).toBeTypeOf('function');
    expect(createPolicyException).toBeTypeOf('function');
    expect(createApprovalRecord).toBeTypeOf('function');
  });
});
