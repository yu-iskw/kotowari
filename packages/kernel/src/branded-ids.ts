import { KernelError } from './errors.js';

export type Brand<T, B extends string> = T & { readonly __brand: B };

export type TenantId = Brand<string, 'TenantId'>;
export type NamespaceId = Brand<string, 'NamespaceId'>;
export type PrincipalId = Brand<string, 'PrincipalId'>;
export type EntityId = Brand<string, 'EntityId'>;
export type ClaimId = Brand<string, 'ClaimId'>;
export type EvidenceId = Brand<string, 'EvidenceId'>;
export type DecisionId = Brand<string, 'DecisionId'>;
export type PolicyId = Brand<string, 'PolicyId'>;
export type ConflictId = Brand<string, 'ConflictId'>;
export type EventId = Brand<string, 'EventId'>;
export type ProvenanceId = Brand<string, 'ProvenanceId'>;
export type ContextId = Brand<string, 'ContextId'>;
export type MemoryId = Brand<string, 'MemoryId'>;
export type IsoTimestamp = Brand<string, 'IsoTimestamp'>;

function asBranded(value: string, brand: string): string {
  if (value.trim().length === 0) {
    throw new KernelError('INVALID_ID', `${brand} must not be empty`);
  }
  return value;
}

export function asTenantId(value: string): TenantId {
  return asBranded(value, 'TenantId') as TenantId;
}

export function asNamespaceId(value: string): NamespaceId {
  return asBranded(value, 'NamespaceId') as NamespaceId;
}

export function asPrincipalId(value: string): PrincipalId {
  return asBranded(value, 'PrincipalId') as PrincipalId;
}

export function asEntityId(value: string): EntityId {
  return asBranded(value, 'EntityId') as EntityId;
}

export function asClaimId(value: string): ClaimId {
  return asBranded(value, 'ClaimId') as ClaimId;
}

export function asEvidenceId(value: string): EvidenceId {
  return asBranded(value, 'EvidenceId') as EvidenceId;
}

export function asDecisionId(value: string): DecisionId {
  return asBranded(value, 'DecisionId') as DecisionId;
}

export function asPolicyId(value: string): PolicyId {
  return asBranded(value, 'PolicyId') as PolicyId;
}

export function asConflictId(value: string): ConflictId {
  return asBranded(value, 'ConflictId') as ConflictId;
}

export function asEventId(value: string): EventId {
  return asBranded(value, 'EventId') as EventId;
}

export function asProvenanceId(value: string): ProvenanceId {
  return asBranded(value, 'ProvenanceId') as ProvenanceId;
}

export function asContextId(value: string): ContextId {
  return asBranded(value, 'ContextId') as ContextId;
}

export function asMemoryId(value: string): MemoryId {
  return asBranded(value, 'MemoryId') as MemoryId;
}

export function asIsoTimestamp(value: string): IsoTimestamp {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new KernelError('INVALID_ID', 'IsoTimestamp must be a valid ISO-8601 instant');
  }
  return value as IsoTimestamp;
}

export function newId<T extends string>(_brand: T): Brand<string, T> {
  return crypto.randomUUID() as Brand<string, T>;
}
