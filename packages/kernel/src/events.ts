import { newId } from './branded-ids.js';

import type {
  ApprovalRecordId,
  ClaimId,
  ConflictId,
  ContextId,
  DecisionId,
  DecisionRelationId,
  EntityId,
  EventId,
  EvidenceId,
  IsoTimestamp,
  OutcomeObservationId,
  PolicyExceptionId,
  PolicyId,
  PolicyVersionId,
  TenantId,
} from './branded-ids.js';
import type { ApprovalRecord, DecisionRelation, OutcomeObservation, PolicyException } from './decision.js';
import type { Provenance } from './provenance.js';

export type DomainEvent =
  | {
      kind: 'claim.asserted';
      eventId: EventId;
      tenantId: TenantId;
      claimId: ClaimId;
      provenance: Provenance;
      occurredAt: IsoTimestamp;
    }
  | {
      kind: 'claim.retracted';
      eventId: EventId;
      tenantId: TenantId;
      claimId: ClaimId;
      provenance: Provenance;
      occurredAt: IsoTimestamp;
    }
  | {
      kind: 'evidence.inserted';
      eventId: EventId;
      tenantId: TenantId;
      evidenceId: EvidenceId;
      provenance: Provenance;
      occurredAt: IsoTimestamp;
    }
  | {
      kind: 'entity.merged';
      eventId: EventId;
      tenantId: TenantId;
      survivingEntityId: EntityId;
      absorbedEntityIds: readonly EntityId[];
      provenance: Provenance;
      occurredAt: IsoTimestamp;
    }
  | {
      kind: 'decision.recorded';
      eventId: EventId;
      tenantId: TenantId;
      decisionId: DecisionId;
      provenance: Provenance;
      occurredAt: IsoTimestamp;
    }
  | {
      kind: 'decision.related';
      eventId: EventId;
      tenantId: TenantId;
      decisionId: DecisionId;
      relatedDecisionId: DecisionId;
      relationId: DecisionRelationId;
      relation: DecisionRelation;
      provenance: Provenance;
      occurredAt: IsoTimestamp;
    }
  | {
      kind: 'decision.outcome_observed';
      eventId: EventId;
      tenantId: TenantId;
      decisionId: DecisionId;
      outcomeObservationId: OutcomeObservationId;
      observation: OutcomeObservation;
      provenance: Provenance;
      occurredAt: IsoTimestamp;
    }
  | {
      kind: 'decision.approval_recorded';
      eventId: EventId;
      tenantId: TenantId;
      decisionId: DecisionId;
      approvalRecordId: ApprovalRecordId;
      approval: ApprovalRecord;
      provenance: Provenance;
      occurredAt: IsoTimestamp;
    }
  | {
      kind: 'policy.exception_recorded';
      eventId: EventId;
      tenantId: TenantId;
      decisionId: DecisionId;
      policyExceptionId: PolicyExceptionId;
      policyVersionId: PolicyVersionId;
      exception: PolicyException;
      provenance: Provenance;
      occurredAt: IsoTimestamp;
    }
  | {
      kind: 'policy.evaluated';
      eventId: EventId;
      tenantId: TenantId;
      policyId: PolicyId;
      provenance: Provenance;
      occurredAt: IsoTimestamp;
    }
  | {
      kind: 'conflict.resolved';
      eventId: EventId;
      tenantId: TenantId;
      conflictId: ConflictId;
      provenance: Provenance;
      occurredAt: IsoTimestamp;
    }
  | {
      kind: 'context.accessed';
      eventId: EventId;
      tenantId: TenantId;
      contextId: ContextId;
      provenance: Provenance;
      occurredAt: IsoTimestamp;
    };

export type SemanticWriteKind = Exclude<DomainEvent['kind'], 'context.accessed'>;

export function createEventId(): EventId {
  return newId('EventId');
}
