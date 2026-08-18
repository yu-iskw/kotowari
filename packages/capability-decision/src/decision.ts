import { createHash } from 'node:crypto';

import {
  evaluateDecisionAgainstPolicy,
  policyVersionRef,
  selectApplicablePolicies,
} from '@kotowari/capability-policy';
import {
  allow,
  asDecisionId,
  assertAllowed,
  assertNoChainOfThought,
  buildDecisionRecorded,
  compactProvenance,
  newId,
  nowIso,
} from '@kotowari/kernel';

import type {
  ApprovalRecord,
  ContextSnapshot,
  Decision,
  DecisionAuditBundle,
  DecisionRelation,
  DecisionRelationKind,
  Evidence,
  OutcomeMetricValue,
  OutcomeObservation,
  PolicyEvaluation,
  PolicyException,
  PolicyRecord,
  PolicyVersionRef,
  Principal,
  Provenance,
  RetrievalReceipt,
  ScopedMetadata,
  TemporalPerspective,
} from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

export type DecisionRecordRequest = {
  purpose: string;
  query?: string;
  temporal?: TemporalPerspective;
  selectedOutcome: string;
  alternatives?: readonly string[];
  confidence: number;
  rationale?: string;
  chainOfThought?: unknown;
  hiddenCoT?: unknown;
};

export type DecisionReplay = {
  decision: Decision;
  contextSnapshot: ContextSnapshot;
  retrievalReceipt?: RetrievalReceipt;
  policyVersions: readonly PolicyRecord[];
  complete: boolean;
  missing: readonly string[];
};

export type DecisionPrecedent = {
  decision: Decision;
  score: number;
  reasons: readonly string[];
};

function decisionScope(principal: Principal) {
  const namespaceId = principal.namespaceIds[0];
  if (namespaceId === undefined) {
    throw new Error('Principal has no namespace');
  }
  return {
    kind: 'decision' as const,
    id: namespaceId,
    metadata: {
      tenantId: principal.tenantId,
      namespaceId,
      principalId: principal.id,
      classification: 'internal' as const,
      visibility: 'workspace' as const,
      policyTags: [],
    },
  };
}

function lifecycleMetadata(decision: Decision): ScopedMetadata {
  return {
    tenantId: decision.tenantId,
    namespaceId: decision.namespaceId,
    principalId: decision.principalId,
    classification: decision.classification,
    visibility: decision.visibility,
    policyTags: decision.policyTags,
  };
}

export async function recordDecisionCapability(input: {
  store: CanonicalStore;
  principal: Principal;
  request: DecisionRecordRequest;
  captureContext: (
    principal: Principal,
    request: { purpose: string; query?: string; temporal?: TemporalPerspective },
    policies: readonly PolicyRecord[],
  ) => Promise<ContextSnapshot>;
}): Promise<Decision> {
  assertNoChainOfThought(input.request);
  assertAllowed(input.principal, 'decision.record', decisionScope(input.principal), {
    tenantId: input.principal.tenantId,
  });

  const allPolicies = await input.store.listPolicies({ tenantId: input.principal.tenantId });
  const policies = selectApplicablePolicies(allPolicies, {
    purpose: input.request.purpose,
    namespaceId: input.principal.namespaceIds[0],
    classification: 'internal',
    at: input.request.temporal?.knownAt ?? input.request.temporal?.validAt,
  });
  const snapshot = await input.captureContext(
    input.principal,
    {
      purpose: input.request.purpose,
      ...(input.request.query === undefined ? {} : { query: input.request.query }),
      ...(input.request.temporal === undefined ? {} : { temporal: input.request.temporal }),
    },
    policies,
  );
  const candidate = {
    selectedOutcome: input.request.selectedOutcome,
    confidence: input.request.confidence,
    classification: 'internal' as const,
  };
  const evaluations: PolicyEvaluation[] = policies.map(
    (policy) => evaluateDecisionAgainstPolicy(input.principal, policy, candidate).evaluation,
  );
  const { decision, event } = buildDecisionRecorded({
    metadata: {
      tenantId: input.principal.tenantId,
      namespaceId: input.principal.namespaceIds[0] ?? snapshot.namespaceId,
      principalId: input.principal.id,
      classification: 'internal',
      visibility: 'workspace',
      policyTags: [input.request.purpose],
    },
    inputContextSnapshot: snapshot,
    consideredEvidenceIds: snapshot.evidenceIds,
    applicablePolicyIds: policies.map((policy) => policyVersionRef(policy).policyId),
    selectedOutcome: input.request.selectedOutcome,
    alternatives: input.request.alternatives ?? [],
    confidence: input.request.confidence,
    actor: input.principal.id,
    rationale: input.request.rationale,
    resultingActionIds: [],
    policyEvaluations: evaluations,
    provenance: compactProvenance({
      source: 'decision',
      actor: input.principal.id,
      process: 'decision.record',
    }),
  });
  await input.store.withTransaction(async (tx) => {
    await tx.putDecision(decision);
    await tx.appendEvent(event);
    await tx.appendOutbox(event);
  });
  return decision;
}

function parseLegacyPolicyVersionKey(value: string): { id: string; version: number } | undefined {
  const separator = value.lastIndexOf('@');
  if (separator <= 0) {
    return undefined;
  }
  const version = Number(value.slice(separator + 1));
  if (!Number.isInteger(version)) {
    return undefined;
  }
  return { id: value.slice(0, separator), version };
}

function refsFromSnapshot(snapshot: ContextSnapshot): readonly PolicyVersionRef[] {
  if (snapshot.policyVersions.length > 0) {
    return snapshot.policyVersions;
  }
  return (snapshot.policyVersionIds ?? []).flatMap((key) => {
    const parsed = parseLegacyPolicyVersionKey(key);
    if (parsed === undefined) {
      return [];
    }
    return [
      {
        policyId: parsed.id as PolicyVersionRef['policyId'],
        policyVersionId: parsed.id as PolicyVersionRef['policyVersionId'],
        version: parsed.version,
      },
    ];
  });
}

async function loadPolicyVersions(
  store: CanonicalStore,
  snapshot: ContextSnapshot,
): Promise<{ policies: readonly PolicyRecord[]; missing: readonly string[] }> {
  const records = await store.listPolicies({ tenantId: snapshot.tenantId });
  const policies: PolicyRecord[] = [];
  const missing: string[] = [];
  for (const ref of refsFromSnapshot(snapshot)) {
    const match = records.find((record) => {
      const candidate = policyVersionRef(record);
      return candidate.policyVersionId === ref.policyVersionId && candidate.version === ref.version;
    });
    if (match === undefined) {
      missing.push(`policy:${ref.policyVersionId}@${String(ref.version)}`);
    } else {
      policies.push(match);
    }
  }
  return { policies, missing };
}

export async function replayDecisionCapability(input: {
  store: CanonicalStore;
  principal: Principal;
  decisionId: string;
}): Promise<DecisionReplay | undefined> {
  const decision = await input.store.getDecision(asDecisionId(input.decisionId));
  if (decision === undefined) {
    return undefined;
  }
  assertAllowed(
    input.principal,
    'decision.read',
    { kind: 'decision', id: decision.id, metadata: decision },
    { tenantId: input.principal.tenantId, purpose: 'decision-replay' },
  );

  const snapshot = decision.inputContextSnapshot;
  const missing: string[] = [];
  const retrievalReceipt =
    snapshot.retrievalReceiptId === undefined
      ? undefined
      : await input.store.getRetrievalReceipt(snapshot.retrievalReceiptId);
  if (snapshot.retrievalReceiptId !== undefined && retrievalReceipt === undefined) {
    missing.push(`retrieval:${snapshot.retrievalReceiptId}`);
  }

  const loadedPolicies = await loadPolicyVersions(input.store, snapshot);
  missing.push(...loadedPolicies.missing);

  return {
    decision,
    contextSnapshot: snapshot,
    ...(retrievalReceipt === undefined ? {} : { retrievalReceipt }),
    policyVersions: loadedPolicies.policies,
    complete: missing.length === 0,
    missing,
  };
}

function claimOverlap(left: Decision, right: Decision): number {
  const leftIds = new Set(left.inputContextSnapshot.claimIds);
  const rightIds = new Set(right.inputContextSnapshot.claimIds);
  if (leftIds.size === 0 || rightIds.size === 0) {
    return 0;
  }
  const intersection = [...leftIds].filter((id) => rightIds.has(id)).length;
  return intersection / new Set([...leftIds, ...rightIds]).size;
}

export async function findDecisionPrecedentsCapability(input: {
  store: CanonicalStore;
  principal: Principal;
  decisionId: string;
  limit?: number;
}): Promise<readonly DecisionPrecedent[]> {
  const target = await input.store.getDecision(asDecisionId(input.decisionId));
  if (target === undefined) {
    return [];
  }
  const decisions = await input.store.listDecisions({
    tenantId: input.principal.tenantId,
    namespaceId: input.principal.namespaceIds[0],
  });
  return decisions
    .filter((candidate) => candidate.id !== target.id)
    .filter(
      (candidate) =>
        allow(
          input.principal,
          'decision.read',
          { kind: 'decision', id: candidate.id, metadata: candidate },
          { tenantId: input.principal.tenantId, purpose: 'precedent-search' },
        ).effect === 'allow',
    )
    .map((candidate) => {
      const reasons: string[] = [];
      let score = claimOverlap(target, candidate) * 0.6;
      if (candidate.selectedOutcome === target.selectedOutcome) {
        score += 0.25;
        reasons.push('same selected outcome');
      }
      if (candidate.policyTags.some((tag) => target.policyTags.includes(tag))) {
        score += 0.15;
        reasons.push('same decision purpose');
      }
      if (score > 0) {
        reasons.unshift('shared historical context');
      }
      return { decision: candidate, score, reasons };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, input.limit ?? 5);
}

export function createDecisionRelation(input: {
  from: Decision;
  to: Decision;
  kind: DecisionRelationKind;
  provenance: Provenance;
}): DecisionRelation {
  return {
    ...lifecycleMetadata(input.from),
    id: newId('DecisionRelationId'),
    fromDecisionId: input.from.id,
    toDecisionId: input.to.id,
    kind: input.kind,
    recordedAt: nowIso(),
    provenance: input.provenance,
  };
}

export function createOutcomeObservation(input: {
  decision: Decision;
  outcome: string;
  observedAt?: OutcomeObservation['observedAt'];
  metrics?: Readonly<Record<string, OutcomeMetricValue>>;
  evidenceIds?: OutcomeObservation['evidenceIds'];
  provenance: Provenance;
}): OutcomeObservation {
  return {
    ...lifecycleMetadata(input.decision),
    id: newId('OutcomeObservationId'),
    decisionId: input.decision.id,
    observedAt: input.observedAt ?? nowIso(),
    outcome: input.outcome,
    metrics: input.metrics ?? {},
    evidenceIds: input.evidenceIds ?? [],
    provenance: input.provenance,
  };
}

export function createPolicyException(input: {
  decision: Decision;
  policyVersionId: PolicyException['policyVersionId'];
  reason: string;
  approvedBy?: PolicyException['approvedBy'];
  provenance: Provenance;
}): PolicyException {
  return {
    ...lifecycleMetadata(input.decision),
    id: newId('PolicyExceptionId'),
    decisionId: input.decision.id,
    policyVersionId: input.policyVersionId,
    reason: input.reason,
    ...(input.approvedBy === undefined ? {} : { approvedBy: input.approvedBy }),
    recordedAt: nowIso(),
    provenance: input.provenance,
  };
}

export function createApprovalRecord(input: {
  decision: Decision;
  approver: ApprovalRecord['approver'];
  status: ApprovalRecord['status'];
  method?: string;
  context?: string;
  provenance: Provenance;
}): ApprovalRecord {
  return {
    ...lifecycleMetadata(input.decision),
    id: newId('ApprovalRecordId'),
    decisionId: input.decision.id,
    approver: input.approver,
    status: input.status,
    ...(input.method === undefined ? {} : { method: input.method }),
    ...(input.context === undefined ? {} : { context: input.context }),
    recordedAt: nowIso(),
    provenance: input.provenance,
  };
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function eventTouchesDecisionContext(
  event: Awaited<ReturnType<CanonicalStore['listEvents']>>[number],
  decision: Decision,
): boolean {
  if (event.tenantId !== decision.tenantId) {
    return false;
  }
  if ('decisionId' in event && event.decisionId === decision.id) {
    return true;
  }
  if ('claimId' in event && decision.inputContextSnapshot.claimIds.includes(event.claimId)) {
    return true;
  }
  if (
    'evidenceId' in event &&
    decision.inputContextSnapshot.evidenceIds.includes(event.evidenceId)
  ) {
    return true;
  }
  return false;
}

export async function buildDecisionAuditBundleCapability(input: {
  store: CanonicalStore;
  principal: Principal;
  decisionId: string;
}): Promise<DecisionAuditBundle | undefined> {
  const replay = await replayDecisionCapability(input);
  if (replay === undefined) {
    return undefined;
  }
  const { decision, contextSnapshot, retrievalReceipt, policyVersions } = replay;
  assertAllowed(
    input.principal,
    'audit.read',
    { kind: 'decision', id: decision.id, metadata: decision },
    { tenantId: input.principal.tenantId, purpose: 'decision-audit' },
  );

  const temporal = {
    ...contextSnapshot.temporal,
    knownAt: contextSnapshot.temporal.knownAt ?? contextSnapshot.capturedAt,
  };
  const visibleClaims = await input.store.listClaims({
    tenantId: decision.tenantId,
    namespaceId: decision.namespaceId,
    temporal,
  });
  const claimIdSet = new Set(contextSnapshot.claimIds);
  const claims = visibleClaims.filter((claim) => claimIdSet.has(claim.id));
  const evidence = (
    await Promise.all(contextSnapshot.evidenceIds.map((id) => input.store.getEvidence(id)))
  ).filter((item): item is Evidence => item !== undefined);
  const authorizationReceipts = retrievalReceipt?.authorizationReceipts ?? [];
  const events = (await input.store.listEvents()).filter((event) =>
    eventTouchesDecisionContext(event, decision),
  );
  const generatedAt = nowIso();

  const bundle: DecisionAuditBundle = {
    id: newId('AuditBundleId'),
    decision,
    contextSnapshot,
    ...(retrievalReceipt === undefined ? {} : { retrievalReceipt }),
    claims,
    evidence,
    policyVersions,
    authorizationReceipts,
    relations: [],
    outcomes: [],
    exceptions: [],
    approvals: [],
    events,
    manifest: {
      schemaVersion: 'decision-audit-v1',
      generatedAt,
      contentHashes: {
        decision: hash(decision),
        context: hash(contextSnapshot),
        retrieval: hash(retrievalReceipt ?? null),
        claims: hash(claims),
        evidence: hash(evidence),
        policyVersions: hash(policyVersions),
        authorizationReceipts: hash(authorizationReceipts),
        events: hash(events),
      },
    },
  };
  return bundle;
}
