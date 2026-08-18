import { CapabilityKnowledgeError } from './errors.js';

import type {
  DomainEvent,
  EntityId,
  EntityMergeLineage,
  EntityResolutionDecision,
  EntityResolutionProposal,
  EventId,
  NamespaceId,
  TenantId,
} from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

export type EntityResolutionFilter = {
  tenantId: TenantId;
  namespaceId?: NamespaceId;
  entityId?: EntityId;
};

export interface EntityResolutionStore {
  putProposal(proposal: EntityResolutionProposal): Promise<DomainEvent>;
  getProposal(id: EventId): Promise<EntityResolutionProposal | undefined>;
  listProposals(filter: EntityResolutionFilter): Promise<readonly EntityResolutionProposal[]>;
  putDecision(decision: EntityResolutionDecision): Promise<DomainEvent>;
  listDecisions(proposalId?: EventId): Promise<readonly EntityResolutionDecision[]>;
  listMergeLineage(filter: EntityResolutionFilter): Promise<readonly EntityMergeLineage[]>;
  resolveCanonicalEntityId(entityId: EntityId): Promise<EntityId>;
}

type EventStore = Pick<CanonicalStore, 'appendEvent' | 'getEntity' | 'listEvents'>;
type EntityMergedEvent = Extract<DomainEvent, { kind: 'entity.merged' }>;

const RESOLUTION_PROPOSED_EVENT = 'entity.resolution_proposed' as const;

function eventOrder(left: DomainEvent, right: DomainEvent): number {
  return left.occurredAt.localeCompare(right.occurredAt) || left.eventId.localeCompare(right.eventId);
}

export function activeEntityMergeEvents(events: readonly DomainEvent[]): readonly EntityMergedEvent[] {
  const reverted = new Set(
    events
      .filter((event) => event.kind === 'entity.merge_reverted')
      .map((event) => event.mergeEventId),
  );
  return events
    .filter((event): event is EntityMergedEvent => event.kind === 'entity.merged')
    .filter((event) => !reverted.has(event.eventId))
    .sort(eventOrder);
}

export function canonicalEntityIdFromEvents(
  events: readonly DomainEvent[],
  entityId: EntityId,
): EntityId {
  const redirects = new Map<EntityId, EntityId>();
  for (const event of activeEntityMergeEvents(events)) {
    for (const absorbed of event.absorbedEntityIds) {
      redirects.set(absorbed, event.survivingEntityId);
    }
  }

  let current = entityId;
  const seen = new Set<EntityId>();
  while (redirects.has(current)) {
    if (seen.has(current)) {
      throw new CapabilityKnowledgeError(`Entity merge cycle detected at ${current}`);
    }
    seen.add(current);
    current = redirects.get(current) ?? current;
  }
  return current;
}

function proposalMatches(
  proposal: EntityResolutionProposal,
  filter: EntityResolutionFilter,
): boolean {
  return (
    proposal.tenantId === filter.tenantId &&
    (filter.namespaceId === undefined || proposal.namespaceId === filter.namespaceId) &&
    (filter.entityId === undefined ||
      proposal.sourceEntityId === filter.entityId ||
      proposal.candidateEntityId === filter.entityId)
  );
}

export function createEventBackedEntityResolutionStore(store: EventStore): EntityResolutionStore {
  return {
    async putProposal(proposal) {
      const event: DomainEvent = {
        kind: RESOLUTION_PROPOSED_EVENT,
        eventId: proposal.id,
        tenantId: proposal.tenantId,
        proposal,
        provenance: proposal.provenance,
        occurredAt: proposal.proposedAt,
      };
      await store.appendEvent(event);
      return event;
    },

    async getProposal(id) {
      const events = await store.listEvents();
      return events.find(
        (event): event is Extract<DomainEvent, { kind: typeof RESOLUTION_PROPOSED_EVENT }> =>
          event.kind === RESOLUTION_PROPOSED_EVENT && event.eventId === id,
      )?.proposal;
    },

    async listProposals(filter) {
      const events = await store.listEvents();
      return events
        .filter(
          (event): event is Extract<DomainEvent, { kind: typeof RESOLUTION_PROPOSED_EVENT }> =>
            event.kind === RESOLUTION_PROPOSED_EVENT,
        )
        .map((event) => event.proposal)
        .filter((proposal) => proposalMatches(proposal, filter))
        .sort(
          (left, right) =>
            left.proposedAt.localeCompare(right.proposedAt) || left.id.localeCompare(right.id),
        );
    },

    async putDecision(decision) {
      const event: DomainEvent = {
        kind: 'entity.resolution_decided',
        eventId: decision.id,
        tenantId: decision.tenantId,
        decision,
        provenance: decision.provenance,
        occurredAt: decision.decidedAt,
      };
      await store.appendEvent(event);
      return event;
    },

    async listDecisions(proposalId) {
      const events = await store.listEvents();
      return events
        .filter(
          (event): event is Extract<DomainEvent, { kind: 'entity.resolution_decided' }> =>
            event.kind === 'entity.resolution_decided',
        )
        .map((event) => event.decision)
        .filter((decision) => proposalId === undefined || decision.proposalId === proposalId)
        .sort(
          (left, right) =>
            left.decidedAt.localeCompare(right.decidedAt) || left.id.localeCompare(right.id),
        );
    },

    async listMergeLineage(filter) {
      const events = await store.listEvents();
      const reversals = new Map(
        events
          .filter((event) => event.kind === 'entity.merge_reverted')
          .map((event) => [event.mergeEventId, event] as const),
      );
      const merged = events
        .filter((event): event is EntityMergedEvent => event.kind === 'entity.merged')
        .sort(eventOrder);
      const lineages: EntityMergeLineage[] = [];
      for (const event of merged) {
        if (
          filter.entityId !== undefined &&
          event.survivingEntityId !== filter.entityId &&
          !event.absorbedEntityIds.includes(filter.entityId)
        ) {
          continue;
        }
        const entity = await store.getEntity(event.survivingEntityId);
        if (
          entity === undefined ||
          entity.tenantId !== filter.tenantId ||
          (filter.namespaceId !== undefined && entity.namespaceId !== filter.namespaceId)
        ) {
          continue;
        }
        const reversal = reversals.get(event.eventId);
        lineages.push({
          tenantId: entity.tenantId,
          namespaceId: entity.namespaceId,
          principalId: entity.principalId,
          classification: entity.classification,
          visibility: entity.visibility,
          policyTags: entity.policyTags,
          mergeEventId: event.eventId,
          ...(event.resolutionProposalId === undefined
            ? {}
            : { resolutionProposalId: event.resolutionProposalId }),
          survivingEntityId: event.survivingEntityId,
          absorbedEntityIds: event.absorbedEntityIds,
          ...(event.reason === undefined ? {} : { reason: event.reason }),
          recordedAt: event.occurredAt,
          provenance: event.provenance,
          ...(reversal === undefined
            ? {}
            : {
                revertedByEventId: reversal.eventId,
                revertedAt: reversal.occurredAt,
                revertReason: reversal.reason,
              }),
        });
      }
      return lineages;
    },

    async resolveCanonicalEntityId(entityId) {
      return canonicalEntityIdFromEvents(await store.listEvents(), entityId);
    },
  };
}
