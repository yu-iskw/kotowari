import { newId } from './branded-ids.js';
import { KernelError } from './errors.js';
import { createEventId } from './events.js';
import { assertNoChainOfThought, assertProvenance, nowIso } from './provenance.js';
import { classificationRank } from './scoped-metadata.js';

import type { ClaimId, EvidenceId } from './branded-ids.js';
import type { Claim, ClaimStatus } from './claim.js';
import type { Conflict, ConflictKind, ConflictResolution } from './conflict.js';
import type { ContextSnapshot, PolicyEvaluation } from './context.js';
import type {
  AssertClaimInput,
  EvaluatePolicyInput,
  InsertEvidenceInput,
  MergeEntityInput,
  PutEntityInput,
  RecordDecisionInput,
  ResolveConflictInput,
  RetractClaimInput,
  SemanticWriteInput,
} from './contracts.js';
import type { Decision } from './decision.js';
import type { Entity } from './entity.js';
import type { DomainEvent } from './events.js';
import type { Evidence } from './evidence.js';
import type { Provenance } from './provenance.js';
import type { ScopedMetadata } from './scoped-metadata.js';

function assertConfidence(confidence: number): void {
  if (confidence < 0 || confidence > 1 || Number.isNaN(confidence)) {
    throw new KernelError('INVALID_CONFIDENCE', 'Confidence must be between 0 and 1');
  }
}

function assertBitemporal(validFrom: string, validTo: string | undefined): void {
  if (validTo !== undefined && validTo <= validFrom) {
    throw new KernelError('BITEMPORAL_INVALID', 'validTo must be greater than validFrom');
  }
}

function requireContextSnapshot(snapshot: ContextSnapshot | undefined): ContextSnapshot {
  if (snapshot === undefined) {
    throw new KernelError(
      'MISSING_CONTEXT_SNAPSHOT',
      'ADR-0008 requires a context snapshot on a decision',
    );
  }
  return snapshot;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return {};
  }
  return value as Record<string, unknown>;
}

export function requireProvenance(write: SemanticWriteInput): Provenance {
  const provenance = write.input.provenance;
  assertProvenance(provenance);
  return provenance;
}

export function buildEntity(input: PutEntityInput): Entity {
  assertProvenance(input.provenance);
  return {
    ...input.metadata,
    id: newId('EntityId'),
    labels: input.labels,
    aliases: input.aliases ?? [],
    recordedAt: nowIso(),
    provenance: input.provenance,
  };
}

export function buildClaimAsserted(input: AssertClaimInput): { claim: Claim; event: DomainEvent } {
  assertProvenance(input.provenance);
  assertNoChainOfThought(asRecord(input));
  if (input.evidenceIds.length === 0) {
    throw new KernelError('EVIDENCE_REQUIRED', 'A claim without evidence is not knowledge');
  }
  assertConfidence(input.confidence);
  assertBitemporal(input.validFrom, input.validTo);
  const recordedAt = nowIso();
  const status: ClaimStatus = input.status ?? 'asserted';
  const claim: Claim = {
    ...input.metadata,
    id: newId('ClaimId'),
    subject: input.subject,
    predicate: input.predicate,
    object: input.object,
    bitemporal: {
      validFrom: input.validFrom,
      recordedAt,
      assertedAt: input.assertedAt,
      ...(input.validTo === undefined ? {} : { validTo: input.validTo }),
    },
    confidence: input.confidence,
    status,
    evidenceIds: input.evidenceIds,
    provenance: input.provenance,
    ...(input.extractor === undefined ? {} : { extractor: input.extractor }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.extractionVersion === undefined
      ? {}
      : { extractionVersion: input.extractionVersion }),
  };
  return {
    claim,
    event: {
      kind: 'claim.asserted',
      eventId: createEventId(),
      tenantId: input.metadata.tenantId,
      claimId: claim.id,
      provenance: input.provenance,
      occurredAt: recordedAt,
    },
  };
}

export function buildClaimRetracted(
  input: RetractClaimInput,
  existing: Claim,
): { claim: Claim; event: DomainEvent } {
  assertProvenance(input.provenance);
  if (existing.status === 'retracted') {
    throw new KernelError('INVALID_STATUS_TRANSITION', 'Claim is already retracted');
  }
  const occurredAt = nowIso();
  return {
    claim: { ...existing, status: 'retracted', provenance: input.provenance },
    event: {
      kind: 'claim.retracted',
      eventId: createEventId(),
      tenantId: existing.tenantId,
      claimId: existing.id,
      provenance: input.provenance,
      occurredAt,
    },
  };
}

export function buildEvidenceInserted(input: InsertEvidenceInput): {
  evidence: Evidence;
  event: DomainEvent;
} {
  assertProvenance(input.provenance);
  const recordedAt = nowIso();
  const evidence: Evidence = {
    ...input.metadata,
    id: newId('EvidenceId'),
    uri: input.uri,
    contentHash: input.contentHash,
    mimeType: input.mimeType,
    recordedAt,
    provenance: input.provenance,
    ...(input.title === undefined ? {} : { title: input.title }),
  };
  return {
    evidence,
    event: {
      kind: 'evidence.inserted',
      eventId: createEventId(),
      tenantId: input.metadata.tenantId,
      evidenceId: evidence.id,
      provenance: input.provenance,
      occurredAt: recordedAt,
    },
  };
}

export function buildEntityMerged(
  input: MergeEntityInput,
  surviving: Entity,
): { entity: Entity; event: DomainEvent } {
  assertProvenance(input.provenance);
  if (input.absorbedEntityIds.length === 0) {
    throw new KernelError('INVALID_ID', 'entity.merged requires absorbed entity ids');
  }
  const occurredAt = nowIso();
  return {
    entity: surviving,
    event: {
      kind: 'entity.merged',
      eventId: createEventId(),
      tenantId: input.metadata.tenantId,
      survivingEntityId: input.survivingEntityId,
      absorbedEntityIds: input.absorbedEntityIds,
      provenance: input.provenance,
      occurredAt,
    },
  };
}

export function buildDecisionRecorded(input: RecordDecisionInput): {
  decision: Decision;
  event: DomainEvent;
} {
  assertProvenance(input.provenance);
  assertNoChainOfThought(asRecord(input));
  const snapshot = requireContextSnapshot(input.inputContextSnapshot);
  assertConfidence(input.confidence);
  const recordedAt = nowIso();
  const decision: Decision = {
    ...input.metadata,
    id: newId('DecisionId'),
    inputContextSnapshotId: snapshot.id,
    inputContextSnapshot: snapshot,
    consideredEvidenceIds: input.consideredEvidenceIds,
    applicablePolicyIds: input.applicablePolicyIds,
    selectedOutcome: input.selectedOutcome,
    alternatives: input.alternatives,
    confidence: input.confidence,
    actor: input.actor,
    resultingActionIds: input.resultingActionIds,
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.runtimeId === undefined ? {} : { runtimeId: input.runtimeId }),
    ...(input.rationale === undefined ? {} : { rationale: input.rationale }),
    ...(input.observedOutcome === undefined ? {} : { observedOutcome: input.observedOutcome }),
    policyEvaluations: input.policyEvaluations,
    recordedAt,
    provenance: input.provenance,
  };
  return {
    decision,
    event: {
      kind: 'decision.recorded',
      eventId: createEventId(),
      tenantId: input.metadata.tenantId,
      decisionId: decision.id,
      provenance: input.provenance,
      occurredAt: recordedAt,
    },
  };
}

export function buildPolicyEvaluated(input: EvaluatePolicyInput): {
  evaluation: PolicyEvaluation;
  event: DomainEvent;
} {
  assertProvenance(input.provenance);
  const violations: string[] = [];
  if (
    input.rules.minConfidence !== undefined &&
    (input.confidence ?? 1) < input.rules.minConfidence
  ) {
    violations.push(`confidence below ${String(input.rules.minConfidence)}`);
  }
  if (
    input.candidateOutcome !== undefined &&
    input.rules.allowedOutcomes !== undefined &&
    !input.rules.allowedOutcomes.includes(input.candidateOutcome)
  ) {
    violations.push(`outcome ${input.candidateOutcome} is not allowed`);
  }
  if (
    input.rules.maxClassification !== undefined &&
    input.classification !== undefined &&
    classificationRank(input.classification) > classificationRank(input.rules.maxClassification)
  ) {
    violations.push(`classification exceeds ${input.rules.maxClassification}`);
  }
  const evaluation: PolicyEvaluation = {
    ...input.metadata,
    policyId: input.policyId,
    policyVersion: input.policyVersion,
    compliant: violations.length === 0,
    violations,
    provenance: input.provenance,
  };
  return {
    evaluation,
    event: {
      kind: 'policy.evaluated',
      eventId: createEventId(),
      tenantId: input.metadata.tenantId,
      policyId: input.policyId,
      provenance: input.provenance,
      occurredAt: nowIso(),
    },
  };
}

export function buildConflictDetected(input: {
  metadata: ScopedMetadata;
  kind: ConflictKind;
  claimIds: readonly ClaimId[];
}): Conflict {
  if (input.claimIds.length < 2) {
    throw new KernelError('INVALID_ID', 'A conflict requires at least two claims');
  }
  return {
    ...input.metadata,
    id: newId('ConflictId'),
    kind: input.kind,
    claimIds: input.claimIds,
    recordedAt: nowIso(),
  };
}

export function buildConflictResolved(input: ResolveConflictInput): {
  conflict: Conflict;
  resolution: ConflictResolution;
  event: DomainEvent;
} {
  assertProvenance(input.provenance);
  if (input.claimIds.length < 2) {
    throw new KernelError('INVALID_ID', 'A conflict requires at least two claims');
  }
  if (!input.claimIds.includes(input.preferredClaimId)) {
    throw new KernelError('INVALID_ID', 'preferredClaimId must be one of the conflicting claims');
  }
  const recordedAt = nowIso();
  const id = newId('ConflictId');
  const conflict: Conflict = {
    ...input.metadata,
    id,
    kind: input.kind,
    claimIds: input.claimIds,
    recordedAt,
  };
  const resolution: ConflictResolution = {
    ...input.metadata,
    id,
    claimIds: input.claimIds,
    strategy: input.strategy,
    preferredClaimId: input.preferredClaimId,
    reason: input.reason,
    provenance: input.provenance,
    recordedAt,
  };
  return {
    conflict,
    resolution,
    event: {
      kind: 'conflict.resolved',
      eventId: createEventId(),
      tenantId: input.metadata.tenantId,
      conflictId: id,
      provenance: input.provenance,
      occurredAt: recordedAt,
    },
  };
}

export function buildContextSnapshot(input: {
  metadata: ScopedMetadata;
  purpose: string;
  claimIds: readonly ClaimId[];
  evidenceIds: readonly EvidenceId[];
  policyVersionIds: readonly string[];
  items: ContextSnapshot['items'];
  budget: number;
}): ContextSnapshot {
  return {
    ...input.metadata,
    id: newId('ContextId'),
    capturedAt: nowIso(),
    purpose: input.purpose,
    namespaceIds: [input.metadata.namespaceId],
    claimIds: input.claimIds,
    evidenceIds: input.evidenceIds,
    policyVersionIds: input.policyVersionIds,
    items: input.items,
    budget: input.budget,
  };
}
