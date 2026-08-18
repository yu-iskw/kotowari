import { describe, expect, it } from 'vitest';

import { asIsoTimestamp, asPrincipalId, localStandaloneMetadata, newId } from '../contracts.js';
import { createEventBackedDecisionLifecycleStore } from '../decision-lifecycle-store.js';

import type { CanonicalStore } from '../ports.js';

const INSTANT = asIsoTimestamp('2026-08-18T00:00:00.000Z');

type StoreFactory = () => CanonicalStore | Promise<CanonicalStore>;

function provenance() {
  return {
    source: 'decision-lifecycle-compliance',
    actor: asPrincipalId('local-user'),
    process: 'decision-lifecycle-store',
    timestamp: INSTANT,
    parentIds: [] as const,
  };
}

export function decisionLifecycleStoreComplianceTests(factory: StoreFactory): void {
  describe('DecisionLifecycleStore compliance', () => {
    it('round-trips immutable lifecycle records through the durable event store', async () => {
      const canonical = await factory();
      const store = createEventBackedDecisionLifecycleStore(canonical);
      const metadata = localStandaloneMetadata();
      const firstDecisionId = newId('DecisionId');
      const secondDecisionId = newId('DecisionId');
      const relation = {
        ...metadata,
        id: newId('DecisionRelationId'),
        fromDecisionId: firstDecisionId,
        toDecisionId: secondDecisionId,
        kind: 'depends_on' as const,
        recordedAt: INSTANT,
        provenance: provenance(),
      };
      const outcome = {
        ...metadata,
        id: newId('OutcomeObservationId'),
        decisionId: firstDecisionId,
        observedAt: INSTANT,
        outcome: 'successful',
        metrics: { latencyMs: 42 },
        evidenceIds: [],
        provenance: provenance(),
      };
      const exception = {
        ...metadata,
        id: newId('PolicyExceptionId'),
        decisionId: firstDecisionId,
        policyVersionId: newId('PolicyVersionId'),
        reason: 'temporary migration window',
        recordedAt: INSTANT,
        provenance: provenance(),
      };
      const approval = {
        ...metadata,
        id: newId('ApprovalRecordId'),
        decisionId: firstDecisionId,
        approver: asPrincipalId('local-user'),
        status: 'approved' as const,
        recordedAt: INSTANT,
        provenance: provenance(),
      };

      await store.putDecisionRelation(relation);
      await store.putOutcomeObservation(outcome);
      await store.putPolicyException(exception);
      await store.putApprovalRecord(approval);

      const filter = {
        tenantId: metadata.tenantId,
        namespaceId: metadata.namespaceId,
        decisionId: firstDecisionId,
      };
      expect(await store.listDecisionRelations(filter)).toEqual([relation]);
      expect(await store.listOutcomeObservations(filter)).toEqual([outcome]);
      expect(await store.listPolicyExceptions(filter)).toEqual([exception]);
      expect(await store.listApprovalRecords(filter)).toEqual([approval]);

      const targetFilter = { ...filter, decisionId: secondDecisionId };
      expect(await store.listDecisionRelations(targetFilter)).toEqual([relation]);
      expect((await canonical.listEvents()).map((event) => event.kind)).toEqual([
        'decision.related',
        'decision.outcome_observed',
        'policy.exception_recorded',
        'decision.approval_recorded',
      ]);
    });
  });
}
