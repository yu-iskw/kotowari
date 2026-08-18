import { createEventId } from './contracts.js';

import type {
  ApprovalRecord,
  DecisionId,
  DecisionRelation,
  DomainEvent,
  NamespaceId,
  OutcomeObservation,
  PolicyException,
  TenantId,
} from './contracts.js';
import type { CanonicalStore } from './ports.js';

export type DecisionLifecycleFilter = {
  tenantId: TenantId;
  namespaceId?: NamespaceId;
  decisionId?: DecisionId;
};

export interface DecisionLifecycleStore {
  putDecisionRelation(relation: DecisionRelation): Promise<DomainEvent>;
  listDecisionRelations(filter: DecisionLifecycleFilter): Promise<readonly DecisionRelation[]>;
  putOutcomeObservation(observation: OutcomeObservation): Promise<DomainEvent>;
  listOutcomeObservations(filter: DecisionLifecycleFilter): Promise<readonly OutcomeObservation[]>;
  putPolicyException(exception: PolicyException): Promise<DomainEvent>;
  listPolicyExceptions(filter: DecisionLifecycleFilter): Promise<readonly PolicyException[]>;
  putApprovalRecord(approval: ApprovalRecord): Promise<DomainEvent>;
  listApprovalRecords(filter: DecisionLifecycleFilter): Promise<readonly ApprovalRecord[]>;
}

type EventStore = Pick<CanonicalStore, 'appendEvent' | 'listEvents'>;

type ScopedLifecycleRecord = {
  tenantId: TenantId;
  namespaceId: NamespaceId;
};

function matchesScope(record: ScopedLifecycleRecord, filter: DecisionLifecycleFilter): boolean {
  return (
    record.tenantId === filter.tenantId &&
    (filter.namespaceId === undefined || record.namespaceId === filter.namespaceId)
  );
}

function relationMatches(relation: DecisionRelation, filter: DecisionLifecycleFilter): boolean {
  return (
    matchesScope(relation, filter) &&
    (filter.decisionId === undefined ||
      relation.fromDecisionId === filter.decisionId ||
      relation.toDecisionId === filter.decisionId)
  );
}

function decisionRecordMatches(
  record: OutcomeObservation | PolicyException | ApprovalRecord,
  filter: DecisionLifecycleFilter,
): boolean {
  return (
    matchesScope(record, filter) &&
    (filter.decisionId === undefined || record.decisionId === filter.decisionId)
  );
}

export function createEventBackedDecisionLifecycleStore(store: EventStore): DecisionLifecycleStore {
  return {
    async putDecisionRelation(relation) {
      const event: DomainEvent = {
        kind: 'decision.related',
        eventId: createEventId(),
        tenantId: relation.tenantId,
        decisionId: relation.fromDecisionId,
        relatedDecisionId: relation.toDecisionId,
        relationId: relation.id,
        relation,
        provenance: relation.provenance,
        occurredAt: relation.recordedAt,
      };
      await store.appendEvent(event);
      return event;
    },

    async listDecisionRelations(filter) {
      const events = await store.listEvents();
      return events
        .filter((event) => event.kind === 'decision.related')
        .map((event) => event.relation)
        .filter((relation) => relationMatches(relation, filter));
    },

    async putOutcomeObservation(observation) {
      const event: DomainEvent = {
        kind: 'decision.outcome_observed',
        eventId: createEventId(),
        tenantId: observation.tenantId,
        decisionId: observation.decisionId,
        outcomeObservationId: observation.id,
        observation,
        provenance: observation.provenance,
        occurredAt: observation.observedAt,
      };
      await store.appendEvent(event);
      return event;
    },

    async listOutcomeObservations(filter) {
      const events = await store.listEvents();
      return events
        .filter((event) => event.kind === 'decision.outcome_observed')
        .map((event) => event.observation)
        .filter((record) => decisionRecordMatches(record, filter));
    },

    async putPolicyException(exception) {
      const event: DomainEvent = {
        kind: 'policy.exception_recorded',
        eventId: createEventId(),
        tenantId: exception.tenantId,
        decisionId: exception.decisionId,
        policyExceptionId: exception.id,
        policyVersionId: exception.policyVersionId,
        exception,
        provenance: exception.provenance,
        occurredAt: exception.recordedAt,
      };
      await store.appendEvent(event);
      return event;
    },

    async listPolicyExceptions(filter) {
      const events = await store.listEvents();
      return events
        .filter((event) => event.kind === 'policy.exception_recorded')
        .map((event) => event.exception)
        .filter((record) => decisionRecordMatches(record, filter));
    },

    async putApprovalRecord(approval) {
      const event: DomainEvent = {
        kind: 'decision.approval_recorded',
        eventId: createEventId(),
        tenantId: approval.tenantId,
        decisionId: approval.decisionId,
        approvalRecordId: approval.id,
        approval,
        provenance: approval.provenance,
        occurredAt: approval.recordedAt,
      };
      await store.appendEvent(event);
      return event;
    },

    async listApprovalRecords(filter) {
      const events = await store.listEvents();
      return events
        .filter((event) => event.kind === 'decision.approval_recorded')
        .map((event) => event.approval)
        .filter((record) => decisionRecordMatches(record, filter));
    },
  };
}
