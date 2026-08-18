import {
  evaluateDecisionAgainstPolicy,
  putPolicyVersion,
  selectApplicablePolicies,
} from '@kotowari/capability-policy';
import {
  allow,
  asDecisionId,
  asPolicyId,
  assertAllowed,
  assertNoChainOfThought,
  buildDecisionRecorded,
  compactProvenance,
} from '@kotowari/kernel';

import type {
  ContextSnapshot,
  Decision,
  PolicyEvaluation,
  PolicyRecord,
  Principal,
  RetrievalReceipt,
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

async function ensurePolicies(
  store: CanonicalStore,
  principal: Principal,
): Promise<readonly PolicyRecord[]> {
  const policies = await store.listPolicies({ tenantId: principal.tenantId });
  if (policies.length > 0) {
    return policies;
  }
  return [
    await putPolicyVersion({
      store,
      principal,
      name: 'workspace-default',
      version: 1,
      rules: {},
      status: 'active',
      applicability: {},
    }),
  ];
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
  const allPolicies = await ensurePolicies(input.store, input.principal);
  const policies = selectApplicablePolicies(allPolicies, {
    purpose: input.request.purpose,
    namespaceId: input.principal.namespaceIds[0],
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
    applicablePolicyIds: policies.map((policy) => policy.id),
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

function parsePolicyVersionKey(value: string): { id: string; version: number } | undefined {
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

  const policyVersions: PolicyRecord[] = [];
  for (const key of snapshot.policyVersionIds) {
    const parsed = parsePolicyVersionKey(key);
    if (parsed === undefined) {
      missing.push(`policy:${key}`);
      continue;
    }
    const policy = await input.store.getPolicy(asPolicyId(parsed.id));
    if (policy === undefined || policy.version !== parsed.version) {
      missing.push(`policy:${key}`);
      continue;
    }
    policyVersions.push(policy);
  }

  return {
    decision,
    contextSnapshot: snapshot,
    ...(retrievalReceipt === undefined ? {} : { retrievalReceipt }),
    policyVersions,
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
