import {
  allowWithReceipt,
  asEntityId,
  asEventId,
  assertAllowed,
  buildEntityMerged,
  classificationRank,
  compactProvenance,
  createEventId,
  nowIso,
} from '@kotowari/kernel';

import {
  canonicalEntityIdFromEvents,
  createEventBackedEntityResolutionStore,
} from './entity-resolution-store.js';
import { CapabilityKnowledgeError } from './errors.js';

import type {
  AuthorizationReceipt,
  Classification,
  DomainEvent,
  Entity,
  EntityExternalId,
  EntityId,
  EntityMergeLineage,
  EntityResolutionDecision,
  EntityResolutionDecisionOutcome,
  EntityResolutionProposal,
  EntityResolutionSignal,
  Principal,
  ScopedMetadata,
  Visibility,
} from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

export const ENTITY_RESOLVER_VERSION = 'entity-resolution-v1' as const;

const ENTITY_RESOLUTION_PURPOSE = 'entity-resolution' as const;
const KNOWLEDGE_READ_ACTION = 'knowledge.read' as const;
const ENTITY_MERGED_EVENT = 'entity.merged' as const;
const ENTITY_MERGE_REVERTED_EVENT = 'entity.merge_reverted' as const;

export type EntityResolutionCandidate = {
  entity: Entity;
  canonicalEntityId: EntityId;
  matchedEntityIds: readonly EntityId[];
  score: number;
  signals: readonly EntityResolutionSignal[];
  reasons: readonly string[];
  authorizationReceipts: readonly AuthorizationReceipt[];
};

type CandidateQuery = {
  labels: readonly string[];
  externalIds: readonly EntityExternalId[];
};

type MutableCandidate = {
  entity: Entity;
  matchedEntityIds: Set<EntityId>;
  score: number;
  signals: EntityResolutionSignal[];
  authorizationReceipts: AuthorizationReceipt[];
};

const VISIBILITY_RANK: Record<Visibility, number> = {
  public: 0,
  workspace: 1,
  private: 2,
};

export function normalizeEntityName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replaceAll(/\s+/g, ' ');
}

function normalizeExternalSystem(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().trim();
}

function normalizeExternalValue(value: string): string {
  return value.normalize('NFKC').trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalizeEntityName(value).split(' ').filter(Boolean));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  const intersection = [...left].filter((item) => right.has(item)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function lexicalSignal(
  query: string,
  candidate: string,
  source: 'label' | 'alias',
): EntityResolutionSignal | undefined {
  const normalizedQuery = normalizeEntityName(query);
  const normalizedCandidate = normalizeEntityName(candidate);
  if (normalizedQuery.length === 0 || normalizedCandidate.length === 0) {
    return undefined;
  }
  if (normalizedQuery === normalizedCandidate) {
    return {
      kind: source === 'label' ? 'label-exact' : 'alias-exact',
      score: source === 'label' ? 1 : 0.92,
      source,
      candidate,
      detail: `${source}: normalized exact match`,
    };
  }

  const overlap = jaccard(tokens(query), tokens(candidate));
  if (overlap >= 0.8) {
    return {
      kind: 'strong-token-overlap',
      score: 0.82,
      source,
      candidate,
      detail: `${source}: strong token overlap (${overlap.toFixed(2)})`,
    };
  }
  if (overlap >= 0.5) {
    return {
      kind: 'partial-token-overlap',
      score: 0.68,
      source,
      candidate,
      detail: `${source}: partial token overlap (${overlap.toFixed(2)})`,
    };
  }
  if (
    normalizedQuery.length >= 3 &&
    (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate))
  ) {
    return {
      kind: 'substring',
      score: 0.58,
      source,
      candidate,
      detail: `${source}: normalized substring match`,
    };
  }
  return undefined;
}

function uniqueSignals(signals: readonly EntityResolutionSignal[]): EntityResolutionSignal[] {
  const deduplicated = new Map<string, EntityResolutionSignal>();
  for (const signal of signals) {
    const key = `${signal.kind}\u0000${signal.source}\u0000${signal.candidate}\u0000${signal.detail}`;
    const existing = deduplicated.get(key);
    if (existing === undefined || signal.score > existing.score) {
      deduplicated.set(key, signal);
    }
  }
  return [...deduplicated.values()].sort(
    (left, right) =>
      right.score - left.score ||
      left.kind.localeCompare(right.kind) ||
      left.source.localeCompare(right.source) ||
      left.candidate.localeCompare(right.candidate),
  );
}

function externalIdSignals(
  query: readonly EntityExternalId[],
  candidate: Entity,
): readonly EntityResolutionSignal[] {
  const signals: EntityResolutionSignal[] = [];
  for (const expected of query) {
    for (const actual of candidate.externalIds ?? []) {
      if (
        normalizeExternalSystem(expected.system) === normalizeExternalSystem(actual.system) &&
        normalizeExternalValue(expected.value) === normalizeExternalValue(actual.value)
      ) {
        signals.push({
          kind: 'external-id-exact',
          score: 1,
          source: `external-id:${actual.system}`,
          candidate: actual.value,
          detail: `external id exact match: ${actual.system}`,
        });
      }
    }
  }
  return signals;
}

function signalsForEntity(
  query: CandidateQuery,
  entity: Entity,
): readonly EntityResolutionSignal[] {
  const signals: EntityResolutionSignal[] = [...externalIdSignals(query.externalIds, entity)];
  for (const label of query.labels) {
    for (const candidate of entity.labels) {
      const signal = lexicalSignal(label, candidate, 'label');
      if (signal !== undefined) {
        signals.push(signal);
      }
    }
    for (const candidate of entity.aliases) {
      const signal = lexicalSignal(label, candidate, 'alias');
      if (signal !== undefined) {
        signals.push(signal);
      }
    }
  }
  return uniqueSignals(signals);
}

function scoreSignals(signals: readonly EntityResolutionSignal[]): number {
  return signals.reduce((score, signal) => Math.max(score, signal.score), 0);
}

function entityResource(entity: Entity) {
  return { kind: 'entity' as const, id: entity.id, metadata: entity };
}

function readReceipt(principal: Principal, entity: Entity): AuthorizationReceipt | undefined {
  const { decision, receipt } = allowWithReceipt(
    principal,
    KNOWLEDGE_READ_ACTION,
    entityResource(entity),
    { tenantId: principal.tenantId, purpose: ENTITY_RESOLUTION_PURPOSE },
  );
  return decision.effect === 'allow' ? receipt : undefined;
}

function uniqueReceipts(
  receipts: readonly AuthorizationReceipt[],
): readonly AuthorizationReceipt[] {
  const byKey = new Map<string, AuthorizationReceipt>();
  for (const receipt of receipts) {
    byKey.set(`${receipt.action}\u0000${receipt.resourceKind}\u0000${receipt.resourceId}`, receipt);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.resourceKind.localeCompare(right.resourceKind) ||
      left.resourceId.localeCompare(right.resourceId),
  );
}

async function scopedEntities(
  store: CanonicalStore,
  principal: Principal,
): Promise<readonly Entity[]> {
  const byId = new Map<EntityId, Entity>();
  for (const namespaceId of principal.namespaceIds) {
    const entities = await store.listEntities({ tenantId: principal.tenantId, namespaceId });
    for (const entity of entities) {
      byId.set(entity.id, entity);
    }
  }
  return [...byId.values()];
}

async function findCandidates(input: {
  store: CanonicalStore;
  principal: Principal;
  query: CandidateQuery;
  limit?: number;
  minScore?: number;
  excludeCanonicalEntityId?: EntityId;
}): Promise<readonly EntityResolutionCandidate[]> {
  const entities = await scopedEntities(input.store, input.principal);
  const entityById = new Map(entities.map((entity) => [entity.id, entity] as const));
  const events = await input.store.listEvents();
  const candidates = new Map<EntityId, MutableCandidate>();
  const minimum = input.minScore ?? 0.5;

  for (const matched of entities) {
    const matchedReceipt = readReceipt(input.principal, matched);
    if (matchedReceipt === undefined) {
      continue;
    }
    const signals = signalsForEntity(input.query, matched);
    const score = scoreSignals(signals);
    if (score < minimum) {
      continue;
    }

    const canonicalEntityId = canonicalEntityIdFromEvents(events, matched.id);
    if (canonicalEntityId === input.excludeCanonicalEntityId) {
      continue;
    }
    const canonical =
      entityById.get(canonicalEntityId) ?? (await input.store.getEntity(canonicalEntityId));
    if (canonical === undefined) {
      continue;
    }
    const canonicalReceipt = readReceipt(input.principal, canonical);
    if (canonicalReceipt === undefined) {
      continue;
    }

    const existing = candidates.get(canonical.id);
    if (existing === undefined) {
      candidates.set(canonical.id, {
        entity: canonical,
        matchedEntityIds: new Set([matched.id]),
        score,
        signals: [...signals],
        authorizationReceipts: [matchedReceipt, canonicalReceipt],
      });
      continue;
    }
    existing.matchedEntityIds.add(matched.id);
    existing.score = Math.max(existing.score, score);
    existing.signals = uniqueSignals([...existing.signals, ...signals]);
    existing.authorizationReceipts.push(matchedReceipt, canonicalReceipt);
  }

  return [...candidates.values()]
    .map((candidate) => ({
      entity: candidate.entity,
      canonicalEntityId: candidate.entity.id,
      matchedEntityIds: [...candidate.matchedEntityIds].sort((left, right) =>
        left.localeCompare(right),
      ),
      score: candidate.score,
      signals: uniqueSignals(candidate.signals),
      reasons: uniqueSignals(candidate.signals).map((signal) => signal.detail),
      authorizationReceipts: uniqueReceipts(candidate.authorizationReceipts),
    }))
    .sort(
      (left, right) => right.score - left.score || left.entity.id.localeCompare(right.entity.id),
    )
    .slice(0, input.limit ?? 5);
}

export async function findEntityResolutionCandidates(input: {
  store: CanonicalStore;
  principal: Principal;
  label: string;
  externalIds?: readonly EntityExternalId[];
  limit?: number;
  minScore?: number;
}): Promise<readonly EntityResolutionCandidate[]> {
  return findCandidates({
    store: input.store,
    principal: input.principal,
    query: { labels: [input.label], externalIds: input.externalIds ?? [] },
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.minScore === undefined ? {} : { minScore: input.minScore }),
  });
}

export async function findEntityResolutionCandidatesForEntity(input: {
  store: CanonicalStore;
  principal: Principal;
  entityId: string;
  limit?: number;
  minScore?: number;
}): Promise<readonly EntityResolutionCandidate[]> {
  const source = await requireEntity(input.store, input.entityId);
  assertAllowed(input.principal, KNOWLEDGE_READ_ACTION, entityResource(source), {
    tenantId: input.principal.tenantId,
    purpose: ENTITY_RESOLUTION_PURPOSE,
  });
  const events = await input.store.listEvents();
  const canonicalSourceId = canonicalEntityIdFromEvents(events, source.id);
  return findCandidates({
    store: input.store,
    principal: input.principal,
    query: {
      labels: [...source.labels, ...source.aliases],
      externalIds: source.externalIds ?? [],
    },
    excludeCanonicalEntityId: canonicalSourceId,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.minScore === undefined ? {} : { minScore: input.minScore }),
  });
}

async function requireEntity(store: CanonicalStore, id: string): Promise<Entity> {
  const entity = await store.getEntity(asEntityId(id));
  if (entity === undefined) {
    throw new CapabilityKnowledgeError(`Entity not found: ${id}`);
  }
  return entity;
}

function assertSameScope(entities: readonly Entity[]): void {
  const first = entities[0];
  if (first === undefined) {
    throw new CapabilityKnowledgeError('Entity resolution requires at least one entity');
  }
  if (
    entities.some(
      (entity) => entity.tenantId !== first.tenantId || entity.namespaceId !== first.namespaceId,
    )
  ) {
    throw new CapabilityKnowledgeError('Entity resolution cannot cross tenant or namespace scope');
  }
}

function strictestClassification(entities: readonly Entity[]): Classification {
  return entities.reduce<Classification>(
    (current, entity) =>
      classificationRank(entity.classification) > classificationRank(current)
        ? entity.classification
        : current,
    'public',
  );
}

function strictestVisibility(entities: readonly Entity[]): Visibility {
  return entities.reduce<Visibility>(
    (current, entity) =>
      VISIBILITY_RANK[entity.visibility] > VISIBILITY_RANK[current] ? entity.visibility : current,
    'public',
  );
}

function resolutionMetadata(principal: Principal, entities: readonly Entity[]): ScopedMetadata {
  assertSameScope(entities);
  const first = entities[0];
  if (first === undefined) {
    throw new CapabilityKnowledgeError('Entity resolution requires at least one entity');
  }
  return {
    tenantId: first.tenantId,
    namespaceId: first.namespaceId,
    principalId: principal.id,
    classification: strictestClassification(entities),
    visibility: strictestVisibility(entities),
    policyTags: [...new Set(entities.flatMap((entity) => entity.policyTags))].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function assertEntityWrite(
  principal: Principal,
  action: 'entity.resolve' | 'entity.merge',
  entities: readonly Entity[],
): void {
  for (const entity of entities) {
    assertAllowed(principal, action, entityResource(entity), {
      tenantId: principal.tenantId,
      purpose: ENTITY_RESOLUTION_PURPOSE,
    });
  }
}

function pairSignals(source: Entity, candidate: Entity): readonly EntityResolutionSignal[] {
  return signalsForEntity(
    {
      labels: [...source.labels, ...source.aliases],
      externalIds: source.externalIds ?? [],
    },
    candidate,
  );
}

async function assertResolutionRoots(
  store: CanonicalStore,
  entities: readonly Entity[],
): Promise<void> {
  const resolutionStore = createEventBackedEntityResolutionStore(store);
  for (const entity of entities) {
    const canonical = await resolutionStore.resolveCanonicalEntityId(entity.id);
    if (canonical !== entity.id) {
      throw new CapabilityKnowledgeError(
        `Entity ${entity.id} is already absorbed by canonical entity ${canonical}`,
      );
    }
  }
}

async function assertNoOpenEquivalentProposal(
  store: CanonicalStore,
  source: Entity,
  candidate: Entity,
): Promise<void> {
  const resolutionStore = createEventBackedEntityResolutionStore(store);
  const events = await store.listEvents();
  const proposals = await resolutionStore.listProposals({
    tenantId: source.tenantId,
    namespaceId: source.namespaceId,
    entityId: source.id,
  });
  for (const proposal of proposals) {
    const samePair =
      (proposal.sourceEntityId === source.id && proposal.candidateEntityId === candidate.id) ||
      (proposal.sourceEntityId === candidate.id && proposal.candidateEntityId === source.id);
    if (!samePair) {
      continue;
    }
    const decisions = await resolutionStore.listDecisions(proposal.id);
    const decision = decisions.at(-1);
    if (decision === undefined) {
      throw new CapabilityKnowledgeError(`Equivalent proposal is still pending: ${proposal.id}`);
    }
    if (decision.outcome === 'approved') {
      const merge = events.find(
        (event) => event.kind === ENTITY_MERGED_EVENT && event.resolutionProposalId === proposal.id,
      );
      if (merge === undefined) {
        throw new CapabilityKnowledgeError(
          `Equivalent proposal is already approved: ${proposal.id}`,
        );
      }
      const reverted = events.some(
        (event) =>
          event.kind === ENTITY_MERGE_REVERTED_EVENT && event.mergeEventId === merge.eventId,
      );
      if (!reverted) {
        throw new CapabilityKnowledgeError(
          `Equivalent entity merge is already active: ${merge.eventId}`,
        );
      }
    }
  }
}

export async function recordEntityResolutionProposal(input: {
  store: CanonicalStore;
  principal: Principal;
  sourceEntityId: string;
  candidateEntityId: string;
}): Promise<EntityResolutionProposal> {
  if (input.sourceEntityId === input.candidateEntityId) {
    throw new CapabilityKnowledgeError('An entity cannot be proposed as a resolution of itself');
  }
  const source = await requireEntity(input.store, input.sourceEntityId);
  const candidate = await requireEntity(input.store, input.candidateEntityId);
  assertSameScope([source, candidate]);
  assertEntityWrite(input.principal, 'entity.resolve', [source, candidate]);
  await assertResolutionRoots(input.store, [source, candidate]);
  await assertNoOpenEquivalentProposal(input.store, source, candidate);

  const signals = pairSignals(source, candidate);
  if (signals.length === 0) {
    throw new CapabilityKnowledgeError('No deterministic identity signal supports this proposal');
  }
  const proposedAt = nowIso();
  const provenance = compactProvenance({
    source: ENTITY_RESOLUTION_PURPOSE,
    actor: input.principal.id,
    process: 'entity.propose_resolution',
  });
  const proposal: EntityResolutionProposal = {
    ...resolutionMetadata(input.principal, [source, candidate]),
    id: createEventId(),
    sourceEntityId: source.id,
    candidateEntityId: candidate.id,
    score: scoreSignals(signals),
    signals,
    resolverVersion: ENTITY_RESOLVER_VERSION,
    proposedBy: input.principal.id,
    proposedAt,
    provenance,
  };

  await input.store.withTransaction(async (tx) => {
    const event = await createEventBackedEntityResolutionStore(tx).putProposal(proposal);
    await tx.appendOutbox(event);
  });
  return proposal;
}

export async function decideEntityResolutionProposal(input: {
  store: CanonicalStore;
  principal: Principal;
  proposalId: string;
  outcome: EntityResolutionDecisionOutcome;
  reason: string;
}): Promise<EntityResolutionDecision> {
  const resolutionStore = createEventBackedEntityResolutionStore(input.store);
  const proposalId = asEventId(input.proposalId);
  const proposal = await resolutionStore.getProposal(proposalId);
  if (proposal === undefined) {
    throw new CapabilityKnowledgeError(`Entity resolution proposal not found: ${input.proposalId}`);
  }
  if (input.reason.trim().length === 0) {
    throw new CapabilityKnowledgeError('A resolution review decision requires a reason');
  }
  if ((await resolutionStore.listDecisions(proposalId)).length > 0) {
    throw new CapabilityKnowledgeError(
      `Entity resolution proposal is already decided: ${proposalId}`,
    );
  }

  const source = await requireEntity(input.store, proposal.sourceEntityId);
  const candidate = await requireEntity(input.store, proposal.candidateEntityId);
  assertSameScope([source, candidate]);
  assertEntityWrite(input.principal, 'entity.resolve', [source, candidate]);

  const decidedAt = nowIso();
  const provenance = compactProvenance({
    source: ENTITY_RESOLUTION_PURPOSE,
    actor: input.principal.id,
    process: 'entity.decide_resolution',
  });
  const decision: EntityResolutionDecision = {
    ...resolutionMetadata(input.principal, [source, candidate]),
    id: createEventId(),
    proposalId,
    outcome: input.outcome,
    reason: input.reason.trim(),
    decidedBy: input.principal.id,
    decidedAt,
    provenance,
  };

  await input.store.withTransaction(async (tx) => {
    const event = await createEventBackedEntityResolutionStore(tx).putDecision(decision);
    await tx.appendOutbox(event);
  });
  return decision;
}

export async function mergeApprovedEntityResolution(input: {
  store: CanonicalStore;
  principal: Principal;
  proposalId: string;
  survivingEntityId: string;
  reason?: string;
}): Promise<EntityMergeLineage> {
  const resolutionStore = createEventBackedEntityResolutionStore(input.store);
  const proposalId = asEventId(input.proposalId);
  const proposal = await resolutionStore.getProposal(proposalId);
  if (proposal === undefined) {
    throw new CapabilityKnowledgeError(`Entity resolution proposal not found: ${input.proposalId}`);
  }
  const decisions = await resolutionStore.listDecisions(proposalId);
  const decision = decisions.at(-1);
  if (decision?.outcome !== 'approved') {
    throw new CapabilityKnowledgeError(`Entity resolution proposal is not approved: ${proposalId}`);
  }

  const survivingEntityId = asEntityId(input.survivingEntityId);
  if (
    survivingEntityId !== proposal.sourceEntityId &&
    survivingEntityId !== proposal.candidateEntityId
  ) {
    throw new CapabilityKnowledgeError('Surviving entity must be one of the proposed entity pair');
  }
  const absorbedEntityId =
    survivingEntityId === proposal.sourceEntityId
      ? proposal.candidateEntityId
      : proposal.sourceEntityId;
  const surviving = await requireEntity(input.store, survivingEntityId);
  const absorbed = await requireEntity(input.store, absorbedEntityId);
  assertSameScope([surviving, absorbed]);
  assertEntityWrite(input.principal, 'entity.merge', [surviving, absorbed]);
  await assertResolutionRoots(input.store, [surviving, absorbed]);

  const events = await input.store.listEvents();
  const previousMerge = events.find(
    (event) => event.kind === ENTITY_MERGED_EVENT && event.resolutionProposalId === proposalId,
  );
  if (previousMerge !== undefined) {
    throw new CapabilityKnowledgeError(
      `Entity resolution proposal was already merged: ${previousMerge.eventId}`,
    );
  }

  const provenance = compactProvenance({
    source: ENTITY_RESOLUTION_PURPOSE,
    actor: input.principal.id,
    process: 'entity.merge_resolution',
  });
  const { event } = buildEntityMerged(
    {
      metadata: resolutionMetadata(input.principal, [surviving, absorbed]),
      survivingEntityId: surviving.id,
      absorbedEntityIds: [absorbed.id],
      resolutionProposalId: proposalId,
      reason: input.reason?.trim() || decision.reason,
      provenance,
    },
    surviving,
  );

  await input.store.withTransaction(async (tx) => {
    await tx.appendEvent(event);
    await tx.appendOutbox(event);
  });
  const lineage = (
    await createEventBackedEntityResolutionStore(input.store).listMergeLineage({
      tenantId: surviving.tenantId,
      namespaceId: surviving.namespaceId,
      entityId: surviving.id,
    })
  ).find((item) => item.mergeEventId === event.eventId);
  if (lineage === undefined) {
    throw new CapabilityKnowledgeError(`Merge lineage was not reconstructed: ${event.eventId}`);
  }
  return lineage;
}

export async function revertEntityMerge(input: {
  store: CanonicalStore;
  principal: Principal;
  mergeEventId: string;
  reason: string;
}): Promise<EntityMergeLineage> {
  if (input.reason.trim().length === 0) {
    throw new CapabilityKnowledgeError('A merge reversal requires a reason');
  }
  const mergeEventId = asEventId(input.mergeEventId);
  const events = await input.store.listEvents();
  const merge = events.find(
    (event): event is Extract<DomainEvent, { kind: 'entity.merged' }> =>
      event.kind === ENTITY_MERGED_EVENT && event.eventId === mergeEventId,
  );
  if (merge === undefined) {
    throw new CapabilityKnowledgeError(`Entity merge event not found: ${mergeEventId}`);
  }
  if (
    events.some(
      (event) => event.kind === ENTITY_MERGE_REVERTED_EVENT && event.mergeEventId === mergeEventId,
    )
  ) {
    throw new CapabilityKnowledgeError(`Entity merge is already reverted: ${mergeEventId}`);
  }

  const surviving = await requireEntity(input.store, merge.survivingEntityId);
  const restored = await Promise.all(
    merge.absorbedEntityIds.map((entityId) => requireEntity(input.store, entityId)),
  );
  const entities = [surviving, ...restored];
  assertSameScope(entities);
  assertEntityWrite(input.principal, 'entity.merge', entities);

  const provenance = compactProvenance({
    source: ENTITY_RESOLUTION_PURPOSE,
    actor: input.principal.id,
    process: 'entity.revert_merge',
  });
  const event: DomainEvent = {
    kind: 'entity.merge_reverted',
    eventId: createEventId(),
    tenantId: surviving.tenantId,
    mergeEventId,
    survivingEntityId: surviving.id,
    restoredEntityIds: restored.map((entity) => entity.id),
    reason: input.reason.trim(),
    provenance,
    occurredAt: nowIso(),
  };
  await input.store.withTransaction(async (tx) => {
    await tx.appendEvent(event);
    await tx.appendOutbox(event);
  });

  const lineage = (
    await createEventBackedEntityResolutionStore(input.store).listMergeLineage({
      tenantId: surviving.tenantId,
      namespaceId: surviving.namespaceId,
      entityId: surviving.id,
    })
  ).find((item) => item.mergeEventId === mergeEventId);
  if (lineage === undefined) {
    throw new CapabilityKnowledgeError(`Merge lineage was not reconstructed: ${mergeEventId}`);
  }
  return lineage;
}

export async function resolveCanonicalEntity(input: {
  store: CanonicalStore;
  principal: Principal;
  entityId: string;
}): Promise<Entity> {
  const entity = await requireEntity(input.store, input.entityId);
  assertAllowed(input.principal, KNOWLEDGE_READ_ACTION, entityResource(entity), {
    tenantId: input.principal.tenantId,
    purpose: ENTITY_RESOLUTION_PURPOSE,
  });
  const canonicalId = await createEventBackedEntityResolutionStore(
    input.store,
  ).resolveCanonicalEntityId(entity.id);
  const canonical = await requireEntity(input.store, canonicalId);
  assertAllowed(input.principal, KNOWLEDGE_READ_ACTION, entityResource(canonical), {
    tenantId: input.principal.tenantId,
    purpose: ENTITY_RESOLUTION_PURPOSE,
  });
  return canonical;
}

export async function listEntityMergeLineage(input: {
  store: CanonicalStore;
  principal: Principal;
  entityId?: string;
}): Promise<readonly EntityMergeLineage[]> {
  const resolutionStore = createEventBackedEntityResolutionStore(input.store);
  const requestedId = input.entityId === undefined ? undefined : asEntityId(input.entityId);
  const lineage: EntityMergeLineage[] = [];
  for (const namespaceId of input.principal.namespaceIds) {
    const scoped = await resolutionStore.listMergeLineage({
      tenantId: input.principal.tenantId,
      namespaceId,
      ...(requestedId === undefined ? {} : { entityId: requestedId }),
    });
    for (const item of scoped) {
      const ids = [item.survivingEntityId, ...item.absorbedEntityIds];
      const entities = (await Promise.all(ids.map((id) => input.store.getEntity(id)))).filter(
        (entity): entity is Entity => entity !== undefined,
      );
      if (entities.length !== ids.length) {
        continue;
      }
      if (entities.every((entity) => readReceipt(input.principal, entity) !== undefined)) {
        lineage.push(item);
      }
    }
  }
  return lineage.sort(
    (left, right) =>
      left.recordedAt.localeCompare(right.recordedAt) ||
      left.mergeEventId.localeCompare(right.mergeEventId),
  );
}
