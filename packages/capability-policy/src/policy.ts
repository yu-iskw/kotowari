import { buildPolicyEvaluated, compactProvenance, newId } from '@kotowari/kernel';

import type { Decision, PolicyEvaluation, PolicyRecord, Principal } from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

export async function putPolicy(input: {
  store: CanonicalStore;
  principal: Principal;
  name: string;
  version: number;
  rules: PolicyRecord['rules'];
}): Promise<PolicyRecord> {
  const namespaceId = input.principal.namespaceIds[0];
  if (namespaceId === undefined) {
    throw new Error('Principal has no namespace');
  }
  const policy: PolicyRecord = {
    id: newId('PolicyId'),
    tenantId: input.principal.tenantId,
    namespaceId,
    principalId: input.principal.id,
    classification: 'internal',
    visibility: 'workspace',
    policyTags: [],
    version: input.version,
    name: input.name,
    rules: input.rules,
  };
  await input.store.putPolicy(policy);
  return policy;
}

export function evaluateDecisionAgainstPolicy(
  principal: Principal,
  policy: PolicyRecord,
  decision: Pick<Decision, 'selectedOutcome' | 'confidence' | 'classification'>,
): { evaluation: PolicyEvaluation } {
  return buildPolicyEvaluated({
    metadata: {
      tenantId: principal.tenantId,
      namespaceId: policy.namespaceId,
      principalId: principal.id,
      classification: policy.classification,
      visibility: policy.visibility,
      policyTags: policy.policyTags,
    },
    policyId: policy.id,
    policyVersion: policy.version,
    name: policy.name,
    rules: policy.rules,
    candidateOutcome: decision.selectedOutcome,
    confidence: decision.confidence,
    classification: decision.classification,
    provenance: compactProvenance({
      source: 'policy',
      actor: principal.id,
      process: 'policy.evaluate',
    }),
  });
}

export async function whatIfPolicy(input: {
  store: CanonicalStore;
  principal: Principal;
  policy: PolicyRecord;
}): Promise<readonly { decisionId: string; wouldFail: boolean; violations: readonly string[] }[]> {
  const decisions = await input.store.listDecisions({
    tenantId: input.principal.tenantId,
    namespaceId: input.principal.namespaceIds[0],
  });
  return decisions.map((decision) => {
    const { evaluation } = evaluateDecisionAgainstPolicy(input.principal, input.policy, decision);
    return {
      decisionId: decision.id,
      wouldFail: !evaluation.compliant,
      violations: evaluation.violations,
    };
  });
}
