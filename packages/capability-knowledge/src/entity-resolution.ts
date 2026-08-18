import { allow, asEntityId } from '@kotowari/kernel';

import type { Entity, Principal } from '@kotowari/kernel';
import type { CanonicalStore } from '@kotowari/plugin-sdk';

export type EntityResolutionCandidate = {
  entity: Entity;
  score: number;
  reasons: readonly string[];
};

function normalize(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
    .replaceAll(/\s+/g, ' ');
}

function tokens(value: string): Set<string> {
  return new Set(normalize(value).split(' ').filter(Boolean));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  const intersection = [...left].filter((item) => right.has(item)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function scoreName(query: string, candidate: string): { score: number; reason: string } {
  const normalizedQuery = normalize(query);
  const normalizedCandidate = normalize(candidate);
  if (normalizedQuery === normalizedCandidate) {
    return { score: 1, reason: 'normalized exact match' };
  }
  const overlap = jaccard(tokens(query), tokens(candidate));
  if (overlap >= 0.8) {
    return { score: 0.9, reason: 'strong token overlap' };
  }
  if (overlap >= 0.5) {
    return { score: 0.72, reason: 'partial token overlap' };
  }
  if (
    normalizedQuery.length >= 4 &&
    (normalizedCandidate.includes(normalizedQuery) || normalizedQuery.includes(normalizedCandidate))
  ) {
    return { score: 0.68, reason: 'normalized substring match' };
  }
  return { score: overlap * 0.6, reason: 'weak token overlap' };
}

function scoreEntity(label: string, entity: Entity): EntityResolutionCandidate {
  let best = { score: 0, reason: 'no lexical match' };
  let field = 'label';
  for (const candidate of entity.labels) {
    const scored = scoreName(label, candidate);
    if (scored.score > best.score) {
      best = scored;
      field = 'label';
    }
  }
  for (const candidate of entity.aliases) {
    const scored = scoreName(label, candidate);
    if (scored.score > best.score) {
      best = scored;
      field = 'alias';
    }
  }
  return {
    entity,
    score: best.score,
    reasons: [`${field}: ${best.reason}`],
  };
}

export async function findEntityResolutionCandidates(input: {
  store: CanonicalStore;
  principal: Principal;
  label: string;
  limit?: number;
  minScore?: number;
}): Promise<readonly EntityResolutionCandidate[]> {
  const namespaceId = input.principal.namespaceIds[0];
  const claims = await input.store.listClaims({
    tenantId: input.principal.tenantId,
    ...(namespaceId === undefined ? {} : { namespaceId }),
  });
  const entityIds = new Set<string>();
  for (const claim of claims) {
    entityIds.add(claim.subject);
    if (claim.object.kind === 'entity') {
      entityIds.add(claim.object.entityId);
    }
  }

  const candidates: EntityResolutionCandidate[] = [];
  for (const id of entityIds) {
    const entity = await input.store.getEntity(asEntityId(id));
    if (entity === undefined) {
      continue;
    }
    const authorization = allow(
      input.principal,
      'knowledge.read',
      { kind: 'entity', id: entity.id, metadata: entity },
      { tenantId: input.principal.tenantId, purpose: 'entity-resolution' },
    );
    if (authorization.effect === 'deny') {
      continue;
    }
    const candidate = scoreEntity(input.label, entity);
    if (candidate.score >= (input.minScore ?? 0.5)) {
      candidates.push(candidate);
    }
  }

  return candidates
    .sort((left, right) => right.score - left.score || left.entity.id.localeCompare(right.entity.id))
    .slice(0, input.limit ?? 5);
}
