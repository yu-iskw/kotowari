import { buildPolicyEvaluated, compactProvenance, newId } from '@kotowari/kernel';

import type {
  Decision,
  IsoTimestamp,
  NamespaceId,
  PolicyEvaluation,
  PolicyId,
  PolicyRecord,
  PolicyVersion,
  PolicyVersionRef,
  Principal,
} from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

export function policyVersionRef(policy: PolicyRecord): PolicyVersionRef {
  return {
    policyId: 'policyId' in policy ? (policy as PolicyVersion).policyId : policy.id,
    policyVersionId: policy.id,
    version: policy.version,
  };
}

export function policyVersionKey(policy: PolicyRecord): string {
  const ref = policyVersionRef(policy);
  return `${ref.policyVersionId}@${String(ref.version)}`;
}

export function isPolicyApplicable(
  policy: PolicyRecord,
  input: { purpose?: string; namespaceId?: NamespaceId; at?: string },
): boolean {
  if (!('policyId' in policy)) {
    return true;
  }
  const version = policy as PolicyVersion;
  if (version.status !== 'active') {
    return false;
  }
  if (input.at !== undefined) {
    if (version.effectiveFrom !== undefined && input.at < version.effectiveFrom) {
      return false;
    }
    if (version.effectiveTo !== undefined && input.at >= version.effectiveTo) {
      return false;
    }
  }
  if (
    input.purpose !== undefined &&
    version.applicability.purposes !== undefined &&
    !version.applicability.purposes.includes(input.purpose)
  ) {
    return false;
  }
  if (
    input.namespaceId !== undefined &&
    version.applicability.namespaceIds !== undefined &&
    !version.applicability.namespaceIds.includes(input.namespaceId)
  ) {
    return false;
  }
  return true;
}

export function selectApplicablePolicies(
  policies: readonly PolicyRecord[],
  input: { purpose?: string; namespaceId?: NamespaceId; at?: string },
): readonly PolicyRecord[] {
  return policies.filter((policy) => isPolicyApplicable(policy, input));
}

export async function putPolicyVersion(input: {
  store: CanonicalStore;
  principal: Principal;
  policyId?: PolicyId;
  name: string;
  version: number;
  rules: PolicyRecord['rules'];
  status?: PolicyVersion['status'];
  effectiveFrom?: IsoTimestamp;
  effectiveTo?: IsoTimestamp;
  applicability?: PolicyVersion['applicability'];
}): Promise<PolicyVersion> {
  const namespaceId = input.principal.namespaceIds[0];
  if (namespaceId === undefined) {
    throw new Error('Principal has no namespace');
  }
  if (
    input.effectiveFrom !== undefined &&
    input.effectiveTo !== undefined &&
    input.effectiveTo <= input.effectiveFrom
  ) {
    throw new Error('effectiveTo must be greater than effectiveFrom');
  }
  const policy: PolicyVersion = {
    id: newId('PolicyId'),
    policyId: input.policyId ?? newId('PolicyId'),
    tenantId: input.principal.tenantId,
    namespaceId,
    principalId: input.principal.id,
    classification: 'internal',
    visibility: 'workspace',
    policyTags: [],
    version: input.version,
    name: input.name,
    rules: input.rules,
    status: input.status ?? 'active',
    applicability: input.applicability ?? {},
    ...(input.effectiveFrom === undefined ? {} : { effectiveFrom: input.effectiveFrom }),
    ...(input.effectiveTo === undefined ? {} : { effectiveTo: input.effectiveTo }),
  };
  await input.store.putPolicy(policy);
  return policy;
}

export async function putPolicy(input: {
  store: CanonicalStore;
  principal: Principal;
  name: string;
  version: number;
  rules: PolicyRecord['rules'];
}): Promise<PolicyRecord> {
  return putPolicyVersion(input);
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
