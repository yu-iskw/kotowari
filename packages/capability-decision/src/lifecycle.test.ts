import { policyVersionRef, putPolicyVersion } from '@kotowari/capability-policy';
import {
  asPrincipalId,
  buildContextSnapshot,
  buildDecisionRecorded,
  compactProvenance,
  localStandaloneMetadata,
  localStandalonePrincipal,
} from '@kotowari/kernel';
import { createMemoryCanonicalStore } from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import {
  buildDecisionAuditBundleCapability,
  observeDecisionOutcomeCapability,
  recordDecisionApprovalCapability,
  recordPolicyExceptionCapability,
  relateDecisionCapability,
} from './public.js';

async function fixture() {
  const store = createMemoryCanonicalStore();
  const principal = localStandalonePrincipal();
  const metadata = localStandaloneMetadata(principal.id);
  const policy = await putPolicyVersion({
    store,
    principal,
    name: 'lifecycle-policy',
    version: 1,
    rules: {},
  });
  const snapshot = buildContextSnapshot({
    metadata,
    purpose: 'lifecycle-test',
    claimIds: [],
    evidenceIds: [],
    policyVersionIds: [],
    policyVersions: [policyVersionRef(policy)],
    items: [],
    budget: 1,
  });
  const provenance = compactProvenance({
    source: 'test',
    actor: principal.id,
    process: 'fixture',
  });
  const makeDecision = (outcome: string) =>
    buildDecisionRecorded({
      metadata,
      inputContextSnapshot: snapshot,
      consideredEvidenceIds: [],
      applicablePolicyIds: [policyVersionRef(policy).policyId],
      selectedOutcome: outcome,
      alternatives: [],
      confidence: 1,
      actor: asPrincipalId('local-user'),
      resultingActionIds: [],
      policyEvaluations: [],
      provenance,
    }).decision;
  const first = makeDecision('first');
  const second = makeDecision('second');
  await store.putContextSnapshot(snapshot);
  await store.putDecision(first);
  await store.putDecision(second);
  return { store, principal, first, second, policy };
}

describe('decision lifecycle accountability', () => {
  it('persists lifecycle facts with outbox events and reconstructs them in audit', async () => {
    const { store, principal, first, second, policy } = await fixture();
    const relation = await relateDecisionCapability({
      store,
      principal,
      fromDecisionId: first.id,
      toDecisionId: second.id,
      kind: 'depends_on',
    });
    const outcome = await observeDecisionOutcomeCapability({
      store,
      principal,
      decisionId: first.id,
      outcome: 'successful',
      metrics: { latencyMs: 42 },
    });
    const exception = await recordPolicyExceptionCapability({
      store,
      principal,
      decisionId: first.id,
      policyVersionId: policyVersionRef(policy).policyVersionId,
      reason: 'approved migration window',
    });
    const approval = await recordDecisionApprovalCapability({
      store,
      principal,
      decisionId: first.id,
      status: 'approved',
      method: 'human-review',
    });

    expect(relation).toBeDefined();
    expect(outcome).toBeDefined();
    expect(exception).toBeDefined();
    expect(approval?.approver).toBe(principal.id);
    expect((await store.listOutbox()).map((event) => event.kind)).toEqual([
      'decision.related',
      'decision.outcome_observed',
      'policy.exception_recorded',
      'decision.approval_recorded',
    ]);

    const bundle = await buildDecisionAuditBundleCapability({
      store,
      principal,
      decisionId: first.id,
    });
    expect(bundle?.relations).toEqual([relation]);
    expect(bundle?.outcomes).toEqual([outcome]);
    expect(bundle?.exceptions).toEqual([exception]);
    expect(bundle?.approvals).toEqual([approval]);
    expect(bundle?.manifest.contentHashes['relations']).toBeDefined();
    expect(bundle?.manifest.contentHashes['outcomes']).toBeDefined();
    expect(bundle?.manifest.contentHashes['exceptions']).toBeDefined();
    expect(bundle?.manifest.contentHashes['approvals']).toBeDefined();
  });

  it('includes a relationship in the audit bundle of either endpoint decision', async () => {
    const { store, principal, first, second } = await fixture();
    const relation = await relateDecisionCapability({
      store,
      principal,
      fromDecisionId: first.id,
      toDecisionId: second.id,
      kind: 'informed_by',
    });

    const targetAudit = await buildDecisionAuditBundleCapability({
      store,
      principal,
      decisionId: second.id,
    });
    expect(targetAudit?.relations).toEqual([relation]);
    expect(targetAudit?.events.some((event) => event.kind === 'decision.related')).toBe(true);
  });
});
