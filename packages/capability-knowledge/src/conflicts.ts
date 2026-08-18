import {
  allow,
  asClaimId,
  asConflictId,
  assertAllowed,
  buildConflictResolved,
  classificationRank,
  claimObjectsEqual,
  compactProvenance,
  createEventId,
  newId,
  nowIso,
} from '@kotowari/kernel';

import { canonicalEntityIdFromEvents } from './entity-resolution-store.js';
import { CapabilityKnowledgeError } from './errors.js';

import type {
  CardinalityConflictRule,
  Claim,
  ClaimId,
  Classification,
  Conflict,
  ConflictCause,
  ConflictResolution,
  DomainEvent,
  EntityId,
  Principal,
  ScopedMetadata,
  Visibility,
} from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

const CONFLICT_DETECTION_PURPOSE = 'semantic-conflict-detection' as const;
const CONFLICT_DETECT_ACTION = 'conflict.detect' as const;
const KNOWLEDGE_READ_ACTION = 'knowledge.read' as const;
const CONFLICT_RESOLVE_ACTION = 'conflict.resolve' as const;
const MAX_TIMESTAMP = '9999-12-31T23:59:59.999Z' as const;

const VISIBILITY_RANK: Record<Visibility, number> = {
  public: 0,
  workspace: 1,
  private: 2,
};

type ClaimGroup = {
  subject: EntityId;
  rule: CardinalityConflictRule;
  claims: Claim[];
};

function claimSetKey(claimIds: readonly ClaimId[]): string {
  return [...claimIds].sort((left, right) => left.localeCompare(right)).join('\u0000');
}

function conflictIdentity(
  claimIds: readonly ClaimId[],
  cause: ConflictCause | undefined,
): string {
  const causeKey =
    cause === undefined
      ? 'legacy'
      : `${cause.kind}:${cause.subject}:${cause.predicate}:${String(cause.max)}:${cause.ruleSource ?? ''}`;
  return `${causeKey}\u0001${claimSetKey(claimIds)}`;
}

function activeForDetection(claim: Claim): boolean {
  return claim.status === 'asserted' || claim.status === 'conflicted';
}

function activeAt(claim: Claim, at: string): boolean {
  const end = claim.bitemporal.validTo ?? MAX_TIMESTAMP;
  return activeForDetection(claim) && claim.bitemporal.validFrom <= at && at < end;
}

function readable(principal: Principal, claim: Claim): boolean {
  return (
    allow(
      principal,
      KNOWLEDGE_READ_ACTION,
      { kind: 'claim', id: claim.id, metadata: claim },
      { tenantId: principal.tenantId, purpose: CONFLICT_DETECTION_PURPOSE },
    ).effect === 'allow'
  );
}

function ruleTermIndex(
  rules: readonly CardinalityConflictRule[],
): ReadonlyMap<string, CardinalityConflictRule> {
  const index = new Map<string, CardinalityConflictRule>();
  for (const rule of rules) {
    if (!Number.isInteger(rule.max) || rule.max < 1) {
      throw new CapabilityKnowledgeError(
        `Conflict cardinality max must be a positive integer: ${rule.predicate}`,
      );
    }
    for (const term of new Set([rule.predicate, ...rule.terms])) {
      const existing = index.get(term);
      if (
        existing !== undefined &&
        (existing.predicate !== rule.predicate ||
          existing.max !== rule.max ||
          existing.source !== rule.source)
      ) {
        throw new CapabilityKnowledgeError(`Ambiguous conflict-rule term: ${term}`);
      }
      index.set(term, rule);
    }
  }
  return index;
}

function strictestClassification(claims: readonly Claim[]): Classification {
  return claims.reduce<Classification>(
    (current, claim) =>
      classificationRank(claim.classification) > classificationRank(current)
        ? claim.classification
        : current,
    'public',
  );
}

function strictestVisibility(claims: readonly Claim[]): Visibility {
  return claims.reduce<Visibility>(
    (current, claim) =>
      VISIBILITY_RANK[claim.visibility] > VISIBILITY_RANK[current]
        ? claim.visibility
        : current,
    'public',
  );
}

function metadataForClaims(principal: Principal, claims: readonly Claim[]): ScopedMetadata {
  const first = claims[0];
  if (first === undefined) {
    throw new CapabilityKnowledgeError('Conflict requires at least one claim');
  }
  if (
    claims.some(
      (claim) =>
        claim.tenantId !== first.tenantId || claim.namespaceId !== first.namespaceId,
    )
  ) {
    throw new CapabilityKnowledgeError('A conflict cannot cross tenant or namespace scope');
  }
  return {
    tenantId: first.tenantId,
    namespaceId: first.namespaceId,
    principalId: principal.id,
    classification: strictestClassification(claims),
    visibility: strictestVisibility(claims),
    policyTags: [...new Set(claims.flatMap((claim) => claim.policyTags))].sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function canonicalObjectKey(
  events: readonly DomainEvent[],
  claim: Claim,
): string {
  if (claim.object.kind === 'entity') {
    return `entity:${canonicalEntityIdFromEvents(events, claim.object.entityId)}`;
  }
  return `literal:${claim.object.datatype ?? ''}:${claim.object.value}`;
}

function semanticObjectsEqual(
  events: readonly DomainEvent[],
  left: Claim,
  right: Claim,
): boolean {
  if (left.object.kind === 'entity' && right.object.kind === 'entity') {
    return (
      canonicalEntityIdFromEvents(events, left.object.entityId) ===
      canonicalEntityIdFromEvents(events, right.object.entityId)
    );
  }
  return claimObjectsEqual(left.object, right.object);
}

function maximalViolatingSets(
  group: ClaimGroup,
  events: readonly DomainEvent[],
): readonly (readonly Claim[])[] {
  const candidateSets = new Map<string, readonly Claim[]>();
  const startTimes = [...new Set(group.claims.map((claim) => claim.bitemporal.validFrom))].sort(
    (left, right) => left.localeCompare(right),
  );

  for (const at of startTimes) {
    const active = group.claims.filter((claim) => activeAt(claim, at));
    const representatives = new Map<string, Claim>();
    for (const claim of [...active].sort((left, right) => left.id.localeCompare(right.id))) {
      const key = canonicalObjectKey(events, claim);
      if (!representatives.has(key)) {
        representatives.set(key, claim);
      }
    }
    if (representatives.size <= group.rule.max) {
      continue;
    }
    const conflicting = [...representatives.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    candidateSets.set(claimSetKey(conflicting.map((claim) => claim.id)), conflicting);
  }

  const candidates = [...candidateSets.values()];
  return candidates.filter(
    (candidate) =>
      !candidates.some(
        (other) =>
          other.length > candidate.length &&
          candidate.every((claim) => other.some((item) => item.id === claim.id)),
      ),
  );
}

function groupsForClaims(input: {
  claims: readonly Claim[];
  rules: readonly CardinalityConflictRule[];
  events: readonly DomainEvent[];
}): readonly ClaimGroup[] {
  const terms = ruleTermIndex(input.rules);
  const groups = new Map<string, ClaimGroup>();
  for (const claim of input.claims) {
    const rule = terms.get(claim.predicate);
    if (rule === undefined || !activeForDetection(claim)) {
      continue;
    }
    const subject = canonicalEntityIdFromEvents(input.events, claim.subject);
    const key = `${claim.namespaceId}\u0000${subject}\u0000${rule.predicate}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { subject, rule, claims: [claim] });
    } else {
      group.claims.push(claim);
    }
  }
  return [...groups.values()];
}

export async function detectClaimConflicts(input: {
  store: CanonicalStore;
  principal: Principal;
  rules: readonly CardinalityConflictRule[];
}): Promise<readonly Conflict[]> {
  if (input.rules.length === 0) {
    return [];
  }
  const events = await input.store.listEvents();
  const existing = await input.store.listConflicts({ tenantId: input.principal.tenantId });
  const identities = new Set(
    existing.map((conflict) => conflictIdentity(conflict.claimIds, conflict.cause)),
  );
  const detected: Conflict[] = [];

  for (const namespaceId of input.principal.namespaceIds) {
    const claims = (
      await input.store.listClaims({ tenantId: input.principal.tenantId, namespaceId })
    ).filter((claim) => readable(input.principal, claim));

    for (const group of groupsForClaims({ claims, rules: input.rules, events })) {
      for (const conflictingClaims of maximalViolatingSets(group, events)) {
        if (conflictingClaims.length < 2) {
          continue;
        }
        if (
          conflictingClaims.every((claim, index) =>
            conflictingClaims
              .slice(index + 1)
              .every((other) => semanticObjectsEqual(events, claim, other)),
          )
        ) {
          continue;
        }

        const metadata = metadataForClaims(input.principal, conflictingClaims);
        assertAllowed(
          input.principal,
          CONFLICT_DETECT_ACTION,
          {
            kind: 'conflict',
            id: `${group.subject}:${group.rule.predicate}`,
            metadata,
          },
          { tenantId: input.principal.tenantId, purpose: CONFLICT_DETECTION_PURPOSE },
        );
        const cause: ConflictCause = {
          kind: 'max-cardinality',
          subject: group.subject,
          predicate: group.rule.predicate,
          max: group.rule.max,
          ...(group.rule.source === undefined ? {} : { ruleSource: group.rule.source }),
        };
        const claimIds = conflictingClaims.map((claim) => claim.id);
        const identity = conflictIdentity(claimIds, cause);
        if (identities.has(identity)) {
          continue;
        }

        const provenance = compactProvenance({
          source: 'semantic-conflict-detector',
          actor: input.principal.id,
          process: CONFLICT_DETECT_ACTION,
        });
        const recordedAt = nowIso();
        const conflict: Conflict = {
          ...metadata,
          id: newId('ConflictId'),
          kind: 'value',
          claimIds,
          cause,
          provenance,
          recordedAt,
        };
        const event: DomainEvent = {
          kind: 'conflict.detected',
          eventId: createEventId(),
          tenantId: conflict.tenantId,
          conflictId: conflict.id,
          provenance,
          occurredAt: recordedAt,
        };
        await input.store.withTransaction(async (tx) => {
          await tx.putConflict(conflict);
          await tx.appendEvent(event);
          await tx.appendOutbox(event);
        });
        identities.add(identity);
        detected.push(conflict);
      }
    }
  }

  return detected;
}

function sameClaimSet(left: readonly ClaimId[], right: readonly ClaimId[]): boolean {
  return claimSetKey(left) === claimSetKey(right);
}

async function requireClaims(
  store: CanonicalStore,
  principal: Principal,
  claimIds: readonly ClaimId[],
): Promise<readonly Claim[]> {
  const claims = await Promise.all(claimIds.map((id) => store.getClaim(id)));
  if (claims.some((claim) => claim === undefined)) {
    throw new CapabilityKnowledgeError('One or more conflicting claims were not found');
  }
  const resolved = claims.filter((claim): claim is Claim => claim !== undefined);
  for (const claim of resolved) {
    assertAllowed(
      principal,
      KNOWLEDGE_READ_ACTION,
      { kind: 'claim', id: claim.id, metadata: claim },
      { tenantId: principal.tenantId },
    );
  }
  return resolved;
}

export async function resolveClaimConflict(input: {
  store: CanonicalStore;
  principal: Principal;
  conflictId?: string;
  claimIds: readonly [string, string, ...string[]];
  preferredClaimId: string;
  reason: string;
}): Promise<ConflictResolution> {
  if (input.reason.trim().length === 0) {
    throw new CapabilityKnowledgeError('A conflict resolution requires a reason');
  }
  const claimIds = input.claimIds.map((id) => asClaimId(id));
  const conflicts = await input.store.listConflicts({ tenantId: input.principal.tenantId });
  const conflictId = input.conflictId === undefined ? undefined : asConflictId(input.conflictId);
  const existing =
    conflictId === undefined
      ? conflicts.find((conflict) => sameClaimSet(conflict.claimIds, claimIds))
      : conflicts.find((conflict) => conflict.id === conflictId);

  if (conflictId !== undefined && existing === undefined) {
    throw new CapabilityKnowledgeError(`Conflict not found: ${conflictId}`);
  }

  if (existing !== undefined) {
    if (!sameClaimSet(existing.claimIds, claimIds)) {
      throw new CapabilityKnowledgeError('Resolution claim ids do not match the detected conflict');
    }
    const preferredClaimId = asClaimId(input.preferredClaimId);
    if (!existing.claimIds.includes(preferredClaimId)) {
      throw new CapabilityKnowledgeError(
        'preferredClaimId must be one of the conflicting claims',
      );
    }
    assertAllowed(
      input.principal,
      CONFLICT_RESOLVE_ACTION,
      { kind: 'conflict', id: existing.id, metadata: existing },
      { tenantId: input.principal.tenantId },
    );
    const prior = await input.store.listResolutions({ tenantId: input.principal.tenantId });
    if (prior.some((resolution) => resolution.id === existing.id)) {
      throw new CapabilityKnowledgeError(`Conflict is already resolved: ${existing.id}`);
    }
    await requireClaims(input.store, input.principal, existing.claimIds);
    const provenance = compactProvenance({
      source: 'curator',
      actor: input.principal.id,
      process: CONFLICT_RESOLVE_ACTION,
    });
    const recordedAt = nowIso();
    const resolution: ConflictResolution = {
      tenantId: existing.tenantId,
      namespaceId: existing.namespaceId,
      principalId: input.principal.id,
      classification: existing.classification,
      visibility: existing.visibility,
      policyTags: existing.policyTags,
      id: existing.id,
      claimIds: existing.claimIds,
      strategy: 'human_review',
      preferredClaimId,
      reason: input.reason.trim(),
      provenance,
      recordedAt,
    };
    const event: DomainEvent = {
      kind: 'conflict.resolved',
      eventId: createEventId(),
      tenantId: existing.tenantId,
      conflictId: existing.id,
      provenance,
      occurredAt: recordedAt,
    };
    await input.store.withTransaction(async (tx) => {
      await tx.putResolution(resolution);
      await tx.appendEvent(event);
      await tx.appendOutbox(event);
    });
    return resolution;
  }

  const claims = await requireClaims(input.store, input.principal, claimIds);
  const metadata = metadataForClaims(input.principal, claims);
  assertAllowed(
    input.principal,
    CONFLICT_RESOLVE_ACTION,
    { kind: 'conflict', id: claimSetKey(claimIds), metadata },
    { tenantId: input.principal.tenantId },
  );
  const { conflict, resolution, event } = buildConflictResolved({
    metadata,
    kind: 'value',
    claimIds,
    strategy: 'human_review',
    preferredClaimId: asClaimId(input.preferredClaimId),
    reason: input.reason.trim(),
    provenance: compactProvenance({
      source: 'curator',
      actor: input.principal.id,
      process: CONFLICT_RESOLVE_ACTION,
    }),
  });
  await input.store.withTransaction(async (tx) => {
    await tx.putConflict(conflict);
    await tx.putResolution(resolution);
    await tx.appendEvent(event);
    await tx.appendOutbox(event);
  });
  return resolution;
}
