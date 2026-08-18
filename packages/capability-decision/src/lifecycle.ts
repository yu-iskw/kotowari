import { createHash } from 'node:crypto';

import { policyVersionRef } from '@kotowari/capability-policy';
import {
  asDecisionId,
  asEvidenceId,
  asPolicyVersionId,
  assertAllowed,
  compactProvenance,
} from '@kotowari/kernel';
import { createEventBackedDecisionLifecycleStore } from '@kotowari/plugin-sdk';

import {
  buildDecisionAuditBundleCapability as buildBaseDecisionAuditBundleCapability,
  createApprovalRecord,
  createDecisionRelation,
  createOutcomeObservation,
  createPolicyException,
} from './decision.js';

import type {
  ApprovalRecord,
  Decision,
  DecisionAuditBundle,
  DecisionRelation,
  DecisionRelationKind,
  DomainEvent,
  OutcomeMetricValue,
  OutcomeObservation,
  PolicyException,
  Principal,
} from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

const POLICY_EXCEPTION_ACTION = 'policy.exception' as const;

type LifecycleAction =
  | 'decision.relate'
  | 'decision.observe'
  | 'decision.approve'
  | typeof POLICY_EXCEPTION_ACTION;

async function decisionForLifecycle(input: {
  store: CanonicalStore;
  principal: Principal;
  decisionId: string;
  action: LifecycleAction;
  purpose: string;
}): Promise<Decision | undefined> {
  const decision = await input.store.getDecision(asDecisionId(input.decisionId));
  if (decision === undefined) {
    return undefined;
  }
  assertAllowed(
    input.principal,
    input.action,
    { kind: 'decision', id: decision.id, metadata: decision },
    { tenantId: input.principal.tenantId, purpose: input.purpose },
  );
  return decision;
}

async function persistLifecycleEvent(
  store: CanonicalStore,
  write: (lifecycle: ReturnType<typeof createEventBackedDecisionLifecycleStore>) => Promise<DomainEvent>,
): Promise<void> {
  await store.withTransaction(async (tx) => {
    const event = await write(createEventBackedDecisionLifecycleStore(tx));
    await tx.appendOutbox(event);
  });
}

export async function relateDecisionCapability(input: {
  store: CanonicalStore;
  principal: Principal;
  fromDecisionId: string;
  toDecisionId: string;
  kind: DecisionRelationKind;
}): Promise<DecisionRelation | undefined> {
  const from = await decisionForLifecycle({
    store: input.store,
    principal: input.principal,
    decisionId: input.fromDecisionId,
    action: 'decision.relate',
    purpose: 'decision-relate',
  });
  if (from === undefined) {
    return undefined;
  }
  const to = await input.store.getDecision(asDecisionId(input.toDecisionId));
  if (to === undefined) {
    return undefined;
  }
  assertAllowed(
    input.principal,
    'decision.read',
    { kind: 'decision', id: to.id, metadata: to },
    { tenantId: input.principal.tenantId, purpose: 'decision-relate' },
  );

  const relation = createDecisionRelation({
    from,
    to,
    kind: input.kind,
    provenance: compactProvenance({
      source: 'decision',
      actor: input.principal.id,
      process: 'decision.relate',
    }),
  });
  await persistLifecycleEvent(input.store, (lifecycle) =>
    lifecycle.putDecisionRelation(relation),
  );
  return relation;
}

export async function observeDecisionOutcomeCapability(input: {
  store: CanonicalStore;
  principal: Principal;
  decisionId: string;
  outcome: string;
  metrics?: Readonly<Record<string, OutcomeMetricValue>>;
  evidenceIds?: readonly string[];
}): Promise<OutcomeObservation | undefined> {
  const decision = await decisionForLifecycle({
    store: input.store,
    principal: input.principal,
    decisionId: input.decisionId,
    action: 'decision.observe',
    purpose: 'decision-observe',
  });
  if (decision === undefined) {
    return undefined;
  }

  const evidenceIds = (input.evidenceIds ?? []).map(asEvidenceId);
  for (const evidenceId of evidenceIds) {
    const evidence = await input.store.getEvidence(evidenceId);
    if (evidence === undefined) {
      throw new Error(`Evidence not found: ${evidenceId}`);
    }
    assertAllowed(
      input.principal,
      'knowledge.read',
      { kind: 'evidence', id: evidence.id, metadata: evidence },
      { tenantId: input.principal.tenantId, purpose: 'decision-observe' },
    );
  }

  const observation = createOutcomeObservation({
    decision,
    outcome: input.outcome,
    ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
    evidenceIds,
    provenance: compactProvenance({
      source: 'decision',
      actor: input.principal.id,
      process: 'decision.observe',
    }),
  });
  await persistLifecycleEvent(input.store, (lifecycle) =>
    lifecycle.putOutcomeObservation(observation),
  );
  return observation;
}

export async function recordPolicyExceptionCapability(input: {
  store: CanonicalStore;
  principal: Principal;
  decisionId: string;
  policyVersionId: string;
  reason: string;
}): Promise<PolicyException | undefined> {
  const decision = await decisionForLifecycle({
    store: input.store,
    principal: input.principal,
    decisionId: input.decisionId,
    action: POLICY_EXCEPTION_ACTION,
    purpose: 'policy-exception',
  });
  if (decision === undefined) {
    return undefined;
  }

  const policyVersionId = asPolicyVersionId(input.policyVersionId);
  const policy = (await input.store.listPolicies({ tenantId: input.principal.tenantId })).find(
    (candidate) => policyVersionRef(candidate).policyVersionId === policyVersionId,
  );
  if (policy === undefined) {
    throw new Error(`Policy version not found: ${policyVersionId}`);
  }
  assertAllowed(
    input.principal,
    POLICY_EXCEPTION_ACTION,
    { kind: 'policy', id: policy.id, metadata: policy },
    { tenantId: input.principal.tenantId, purpose: 'policy-exception' },
  );

  const exception = createPolicyException({
    decision,
    policyVersionId,
    reason: input.reason,
    provenance: compactProvenance({
      source: 'decision',
      actor: input.principal.id,
      process: POLICY_EXCEPTION_ACTION,
    }),
  });
  await persistLifecycleEvent(input.store, (lifecycle) => lifecycle.putPolicyException(exception));
  return exception;
}

export async function recordDecisionApprovalCapability(input: {
  store: CanonicalStore;
  principal: Principal;
  decisionId: string;
  status: ApprovalRecord['status'];
  method?: string;
  context?: string;
}): Promise<ApprovalRecord | undefined> {
  const decision = await decisionForLifecycle({
    store: input.store,
    principal: input.principal,
    decisionId: input.decisionId,
    action: 'decision.approve',
    purpose: 'decision-approve',
  });
  if (decision === undefined) {
    return undefined;
  }

  const approval = createApprovalRecord({
    decision,
    approver: input.principal.id,
    status: input.status,
    ...(input.method === undefined ? {} : { method: input.method }),
    ...(input.context === undefined ? {} : { context: input.context }),
    provenance: compactProvenance({
      source: 'decision',
      actor: input.principal.id,
      process: 'decision.approve',
    }),
  });
  await persistLifecycleEvent(input.store, (lifecycle) => lifecycle.putApprovalRecord(approval));
  return approval;
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function lifecycleEventTouchesDecision(event: DomainEvent, decisionId: Decision['id']): boolean {
  if (event.kind === 'decision.related') {
    return event.decisionId === decisionId || event.relatedDecisionId === decisionId;
  }
  if (
    event.kind === 'decision.outcome_observed' ||
    event.kind === 'decision.approval_recorded' ||
    event.kind === 'policy.exception_recorded'
  ) {
    return event.decisionId === decisionId;
  }
  return false;
}

export async function buildDecisionAuditBundleCapability(input: {
  store: CanonicalStore;
  principal: Principal;
  decisionId: string;
}): Promise<DecisionAuditBundle | undefined> {
  const base = await buildBaseDecisionAuditBundleCapability(input);
  if (base === undefined) {
    return undefined;
  }

  const lifecycle = createEventBackedDecisionLifecycleStore(input.store);
  const filter = {
    tenantId: base.decision.tenantId,
    namespaceId: base.decision.namespaceId,
    decisionId: base.decision.id,
  };
  const [relations, outcomes, exceptions, approvals, allEvents] = await Promise.all([
    lifecycle.listDecisionRelations(filter),
    lifecycle.listOutcomeObservations(filter),
    lifecycle.listPolicyExceptions(filter),
    lifecycle.listApprovalRecords(filter),
    input.store.listEvents(),
  ]);
  const knownEventIds = new Set(base.events.map((event) => event.eventId));
  const lifecycleEvents = allEvents.filter(
    (event) =>
      lifecycleEventTouchesDecision(event, base.decision.id) && !knownEventIds.has(event.eventId),
  );
  const events = [...base.events, ...lifecycleEvents];

  return {
    ...base,
    relations,
    outcomes,
    exceptions,
    approvals,
    events,
    manifest: {
      ...base.manifest,
      contentHashes: {
        ...base.manifest.contentHashes,
        relations: hash(relations),
        outcomes: hash(outcomes),
        exceptions: hash(exceptions),
        approvals: hash(approvals),
        events: hash(events),
      },
    },
  };
}
