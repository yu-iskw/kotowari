import { KernelError } from './errors.js';
import { classificationRank } from './scoped-metadata.js';

import type { IsoTimestamp, NamespaceId, PrincipalId, TenantId } from './branded-ids.js';
import type { KernelErrorCode } from './errors.js';
import type { Classification, ScopedMetadata } from './scoped-metadata.js';

export const ACTIONS = [
  'knowledge.read',
  'knowledge.write',
  'entity.resolve',
  'entity.merge',
  'memory.read',
  'memory.write',
  'decision.read',
  'decision.record',
  'decision.relate',
  'decision.observe',
  'decision.approve',
  'ingestion.write',
  'policy.evaluate',
  'policy.manage',
  'policy.exception',
  'conflict.resolve',
  'audit.read',
  'admin',
] as const;

export type Action = (typeof ACTIONS)[number];

export type ResourceKind =
  | 'claim'
  | 'entity'
  | 'evidence'
  | 'decision'
  | 'policy'
  | 'conflict'
  | 'memory'
  | 'context'
  | 'namespace';

export type Resource = {
  kind: ResourceKind;
  id: string;
  metadata: ScopedMetadata;
};

export type Delegation = {
  delegatorId: PrincipalId;
  scope: readonly Action[];
  expiresAt: IsoTimestamp;
  purpose?: string;
};

export type Principal =
  | {
      kind: 'human';
      id: PrincipalId;
      tenantId: TenantId;
      clearance: Classification;
      namespaceIds: readonly NamespaceId[];
      roles: readonly string[];
    }
  | {
      kind: 'agent';
      id: PrincipalId;
      tenantId: TenantId;
      clearance: Classification;
      namespaceIds: readonly NamespaceId[];
      roles: readonly string[];
      actingFor?: PrincipalId;
    };

export type AuthContext = {
  tenantId: TenantId;
  purpose?: string;
  delegation?: Delegation;
  now?: IsoTimestamp;
};

export type AuthDecision = {
  effect: 'allow' | 'deny';
  reason: KernelErrorCode;
};

export type AuthorizationReceipt = {
  principalId: PrincipalId;
  actingFor?: PrincipalId;
  action: Action;
  resourceKind: ResourceKind;
  resourceId: string;
  effect: AuthDecision['effect'];
  reason: KernelErrorCode;
  purpose?: string;
  delegation?: Delegation;
  evaluatedAt: IsoTimestamp;
};

const WRITE_ACTIONS: ReadonlySet<Action> = new Set([
  'knowledge.write',
  'entity.resolve',
  'entity.merge',
  'memory.write',
  'decision.record',
  'decision.relate',
  'decision.observe',
  'decision.approve',
  'ingestion.write',
  'policy.evaluate',
  'policy.manage',
  'policy.exception',
  'conflict.resolve',
  'admin',
]);

function isExpired(delegation: Delegation, now: string | undefined): boolean {
  const clock = now ?? new Date().toISOString();
  return clock > delegation.expiresAt;
}

function principalClearanceRank(principal: Principal): number {
  return classificationRank(principal.clearance);
}

function denyIfCrossTenant(
  principal: Principal,
  resource: Resource,
  context: AuthContext,
): AuthDecision | undefined {
  if (principal.tenantId !== context.tenantId || resource.metadata.tenantId !== context.tenantId) {
    return { effect: 'deny', reason: 'CROSS_TENANT_DENIED' };
  }
  return undefined;
}

function denyIfClassificationInsufficient(
  principal: Principal,
  resource: Resource,
): AuthDecision | undefined {
  if (principalClearanceRank(principal) < classificationRank(resource.metadata.classification)) {
    return { effect: 'deny', reason: 'CLASSIFICATION_DENIED' };
  }
  return undefined;
}

function denyIfAgentDelegationInvalid(
  principal: Principal,
  action: Action,
  context: AuthContext,
): AuthDecision | undefined {
  if (principal.kind === 'agent' && principal.actingFor !== undefined) {
    const delegation = context.delegation;
    if (
      delegation === undefined ||
      delegation.delegatorId !== principal.actingFor ||
      !delegation.scope.includes(action) ||
      isExpired(delegation, context.now)
    ) {
      return { effect: 'deny', reason: 'DELEGATION_DENIED' };
    }
    if (
      context.purpose !== undefined &&
      delegation.purpose !== undefined &&
      context.purpose !== delegation.purpose
    ) {
      return { effect: 'deny', reason: 'DELEGATION_DENIED' };
    }
  }
  return undefined;
}

function denyIfPrivateVisibility(
  principal: Principal,
  resource: Resource,
): AuthDecision | undefined {
  const actingAs =
    principal.kind === 'agent' && principal.actingFor !== undefined
      ? principal.actingFor
      : principal.id;

  if (
    resource.metadata.visibility === 'private' &&
    resource.metadata.principalId !== undefined &&
    resource.metadata.principalId !== actingAs
  ) {
    return { effect: 'deny', reason: 'VISIBILITY_DENIED' };
  }
  return undefined;
}

function denyIfViewerCannotWrite(principal: Principal, action: Action): AuthDecision | undefined {
  if (
    WRITE_ACTIONS.has(action) &&
    principal.roles.includes('viewer') &&
    !principal.roles.includes('admin')
  ) {
    return { effect: 'deny', reason: 'ACTION_DENIED' };
  }
  return undefined;
}

export function allow(
  principal: Principal,
  action: Action,
  resource: Resource,
  context: AuthContext,
): AuthDecision {
  const crossTenant = denyIfCrossTenant(principal, resource, context);
  if (crossTenant !== undefined) {
    return crossTenant;
  }

  const classification = denyIfClassificationInsufficient(principal, resource);
  if (classification !== undefined) {
    return classification;
  }

  if (action === 'admin' && !principal.roles.includes('admin')) {
    return { effect: 'deny', reason: 'ACTION_DENIED' };
  }

  const delegation = denyIfAgentDelegationInvalid(principal, action, context);
  if (delegation !== undefined) {
    return delegation;
  }

  const visibility = denyIfPrivateVisibility(principal, resource);
  if (visibility !== undefined) {
    return visibility;
  }

  if (!principal.namespaceIds.includes(resource.metadata.namespaceId)) {
    return { effect: 'deny', reason: 'NAMESPACE_DENIED' };
  }

  const writeRole = denyIfViewerCannotWrite(principal, action);
  if (writeRole !== undefined) {
    return writeRole;
  }

  return { effect: 'allow', reason: 'ALLOW' };
}

export function allowWithReceipt(
  principal: Principal,
  action: Action,
  resource: Resource,
  context: AuthContext,
): { decision: AuthDecision; receipt: AuthorizationReceipt } {
  const decision = allow(principal, action, resource, context);
  const receipt: AuthorizationReceipt = {
    principalId: principal.id,
    ...(principal.kind === 'agent' && principal.actingFor !== undefined
      ? { actingFor: principal.actingFor }
      : {}),
    action,
    resourceKind: resource.kind,
    resourceId: resource.id,
    effect: decision.effect,
    reason: decision.reason,
    ...(context.purpose === undefined ? {} : { purpose: context.purpose }),
    ...(context.delegation === undefined ? {} : { delegation: context.delegation }),
    evaluatedAt: (context.now ?? new Date().toISOString()) as IsoTimestamp,
  };
  return { decision, receipt };
}

export function assertAllowed(
  principal: Principal,
  action: Action,
  resource: Resource,
  context: AuthContext,
): void {
  const decision = allow(principal, action, resource, context);
  if (decision.effect === 'deny') {
    throw new KernelError(decision.reason, `Denied ${action} on ${resource.kind} ${resource.id}`);
  }
}

export function localStandalonePrincipal(): Principal {
  return {
    kind: 'human',
    id: 'local-user' as PrincipalId,
    tenantId: 'local' as TenantId,
    clearance: 'tlp:red',
    namespaceIds: ['local-workspace' as NamespaceId],
    roles: ['member', 'curator'],
  };
}

export function localStandaloneMetadata(principalId?: PrincipalId): ScopedMetadata {
  return {
    tenantId: 'local' as TenantId,
    namespaceId: 'local-workspace' as NamespaceId,
    principalId: principalId ?? ('local-user' as PrincipalId),
    classification: 'internal',
    visibility: 'workspace',
    policyTags: [],
  };
}
