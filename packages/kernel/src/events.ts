import { newId } from './branded-ids.js';

import type {
  ClaimId,
  ConflictId,
  ContextId,
  DecisionId,
  EntityId,
  EventId,
  EvidenceId,
  IsoTimestamp,
  PolicyId,
  TenantId,
} from './branded-ids.js';
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
