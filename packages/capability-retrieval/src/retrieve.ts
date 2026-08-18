import { createHash } from 'node:crypto';

import {
  allow,
  claimText,
  compactProvenance,
  newId,
  normalizeTemporalPerspective,
  nowIso,
} from '@kotowari/kernel';

import type {
  AuthContext,
  Claim,
  ConflictResolution,
  EvidenceId,
  Principal,
  RetrievalReceipt,
  TemporalPerspective,
} from '@kotowari/kernel';
import type { CanonicalStore, EmbeddingProvider, RerankerProvider } from '@kotowari/plugin-sdk';

export type RetrievalPlan = {
  candidates: readonly (
    | { strategy: 'lexical'; limit: number }
    | { strategy: 'vector'; limit: number }
    | { strategy: 'graph'; hops: number }
  )[];
  rerank: string;
  budget: number;
  explain: boolean;
};

export const DEFAULT_RETRIEVAL_PLAN: RetrievalPlan = {
  candidates: [
    { strategy: 'lexical', limit: 30 },
    { strategy: 'vector', limit: 50 },
    { strategy: 'graph', hops: 2 },
  ],
  rerank: 'none',
  budget: 20,
  explain: true,
};

export const RETRIEVAL_PLAN_VERSION = 'retrieval-v1' as const;

export type RetrievalHit = {
  claimId: string;
  score: number;
  scoreComponents: { lexical?: number; vector?: number; graph?: number };
  evidenceIds: readonly EvidenceId[];
  graphRoute?: readonly string[];
  policy: { passed: boolean; filter?: 'policy_filter' };
  whySelected: string;
  claim: Claim;
};

export type RetrievalOmission = {
  reason: 'policy_filter';
  classification: string;
  count: number;
};

export type RetrievalResult = {
  hits: readonly RetrievalHit[];
  omitted: readonly RetrievalOmission[];
  plan: RetrievalPlan;
  receipt: RetrievalReceipt;
};

type GraphCandidate = Extract<RetrievalPlan['candidates'][number], { strategy: 'graph' }>;
type LexicalCandidate = Extract<RetrievalPlan['candidates'][number], { strategy: 'lexical' }>;
type VectorCandidate = Extract<RetrievalPlan['candidates'][number], { strategy: 'vector' }>;

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 1);
}

function cosine(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function explainHit(components: RetrievalHit['scoreComponents']): string {
  const parts = [
    components.lexical === undefined ? undefined : `lexical ${String(components.lexical)}`,
    components.vector === undefined ? undefined : `vector ${components.vector.toFixed(2)}`,
    components.graph === undefined ? undefined : `graph neighborhood`,
  ].filter((part) => part !== undefined);
  return parts.length > 0 ? parts.join('; ') : 'metadata match';
}

function isGraphCandidate(
  candidate: RetrievalPlan['candidates'][number],
): candidate is GraphCandidate {
  return candidate.strategy === 'graph';
}

function isLexicalCandidate(
  candidate: RetrievalPlan['candidates'][number],
): candidate is LexicalCandidate {
  return candidate.strategy === 'lexical';
}

function isVectorCandidate(
  candidate: RetrievalPlan['candidates'][number],
): candidate is VectorCandidate {
  return candidate.strategy === 'vector';
}

function connectedEntityIds(claim: Claim): readonly string[] {
  if (claim.object.kind === 'entity') {
    return [claim.subject, claim.object.entityId];
  }
  return [claim.subject];
}

function hitFromClaim(
  claim: Claim,
  score: number,
  scoreComponents: RetrievalHit['scoreComponents'],
  graphRoute?: readonly string[],
): RetrievalHit {
  return {
    claimId: claim.id,
    score,
    scoreComponents,
    evidenceIds: claim.evidenceIds,
    graphRoute,
    policy: { passed: true },
    whySelected: explainHit(scoreComponents),
    claim,
  };
}

function mergeHit(scored: Map<string, RetrievalHit>, hit: RetrievalHit): void {
  const existing = scored.get(hit.claimId);
  if (existing === undefined || hit.score > existing.score) {
    scored.set(hit.claimId, hit);
  }
}

function expandGraphNeighborhood(
  claims: readonly Claim[],
  scored: Map<string, RetrievalHit>,
  hops: number,
): void {
  let frontier = new Set([...scored.values()].flatMap((hit) => connectedEntityIds(hit.claim)));
  for (let hop = 0; hop < hops; hop += 1) {
    const next = new Set(frontier);
    for (const claim of claims) {
      const ids = connectedEntityIds(claim);
      if (!ids.some((id) => frontier.has(id))) {
        continue;
      }
      for (const id of ids) {
        next.add(id);
      }
      if (!scored.has(claim.id)) {
        mergeHit(
          scored,
          hitFromClaim(claim, 0.3 / (hop + 1), { graph: 0.3 / (hop + 1) }, [claim.subject]),
        );
      }
    }
    frontier = next;
  }
}

function suppressedClaimIds(resolutions: readonly ConflictResolution[]): Set<string> {
  const suppressed = new Set<string>();
  for (const resolution of resolutions) {
    for (const claimId of resolution.claimIds) {
      if (claimId !== resolution.preferredClaimId) {
        suppressed.add(claimId);
      }
    }
  }
  return suppressed;
}

function authorizeHits(input: {
  scored: Map<string, RetrievalHit>;
  suppressed: Set<string>;
  principal: Principal;
  authz: AuthContext;
}): { allowed: RetrievalHit[]; omittedByClass: Map<string, number> } {
  const omittedByClass = new Map<string, number>();
  const allowed: RetrievalHit[] = [];
  for (const hit of input.scored.values()) {
    if (input.suppressed.has(hit.claimId)) {
      continue;
    }
    const decision = allow(
      input.principal,
      'knowledge.read',
      { kind: 'claim', id: hit.claimId, metadata: hit.claim },
      input.authz,
    );
    if (decision.effect === 'deny') {
      const classification = hit.claim.classification;
      omittedByClass.set(classification, (omittedByClass.get(classification) ?? 0) + 1);
      continue;
    }
    allowed.push(hit);
  }
  return { allowed, omittedByClass };
}

async function maybeRerank(input: {
  allowed: RetrievalHit[];
  reranker: RerankerProvider | undefined;
  rerank: string;
  query: string;
}): Promise<RetrievalHit[]> {
  if (input.reranker && input.rerank !== 'none') {
    const reranked = await input.reranker.rerank({
      query: input.query,
      hits: input.allowed.map((hit) => ({ id: hit.claimId, text: claimText(hit.claim) })),
    });
    const byId = new Map(input.allowed.map((hit) => [hit.claimId, hit]));
    return reranked.ids.map((id) => byId.get(id)).filter((hit) => hit !== undefined);
  }
  return input.allowed;
}

function lexicalLimit(plan: RetrievalPlan): number {
  return plan.candidates.find(isLexicalCandidate)?.limit ?? plan.budget;
}

function vectorLimit(plan: RetrievalPlan): number {
  return plan.candidates.find(isVectorCandidate)?.limit ?? plan.budget;
}

function graphHops(plan: RetrievalPlan): number {
  return plan.candidates.find(isGraphCandidate)?.hops ?? 0;
}

export async function retrieve(input: {
  store: CanonicalStore;
  embeddings: EmbeddingProvider;
  reranker?: RerankerProvider;
  principal: Principal;
  authz: AuthContext;
  query: string;
  purpose?: string;
  temporal?: TemporalPerspective;
  /** @deprecated Use temporal.validAt. */
  asOf?: string;
  plan?: RetrievalPlan;
}): Promise<RetrievalResult> {
  const plan = input.plan ?? DEFAULT_RETRIEVAL_PLAN;
  const temporal = normalizeTemporalPerspective(input.temporal, input.asOf);
  const filter = {
    tenantId: input.principal.tenantId,
    namespaceId: input.principal.namespaceIds[0],
    temporal,
  };
  const [claims, embeddings, queryEmbedding, resolutions, lexicalClaims] = await Promise.all([
    input.store.listClaims(filter),
    input.store.listEmbeddings(),
    input.embeddings.embed({ texts: [input.query] }),
    input.store.listResolutions({ tenantId: input.principal.tenantId }),
    input.store.searchLexical({ ...filter, query: input.query, limit: lexicalLimit(plan) }),
  ]);
  const embeddingByClaim = new Map(embeddings.map((row) => [row.claimId, row.vector]));
  const queryTokens = tokenize(input.query);
  const queryVector = queryEmbedding.vectors[0] ?? [];
  const scored = new Map<string, RetrievalHit>();

  for (const claim of lexicalClaims) {
    const lexical = queryTokens.filter((token) =>
      claimText(claim).toLowerCase().includes(token),
    ).length;
    mergeHit(scored, hitFromClaim(claim, lexical, lexical > 0 ? { lexical } : {}));
  }

  const vectorRanked = claims
    .map((claim) => ({
      claim,
      vector: cosine(queryVector, embeddingByClaim.get(claim.id) ?? []),
    }))
    .filter((row) => row.vector >= 0.15)
    .sort((left, right) => right.vector - left.vector)
    .slice(0, vectorLimit(plan));
  for (const row of vectorRanked) {
    const existing = scored.get(row.claim.id);
    const lexical = existing?.scoreComponents.lexical ?? 0;
    mergeHit(
      scored,
      hitFromClaim(row.claim, lexical + row.vector, {
        ...(lexical > 0 ? { lexical } : {}),
        vector: row.vector,
      }),
    );
  }

  const hops = graphHops(plan);
  if (hops > 0) {
    expandGraphNeighborhood(claims, scored, hops);
  }

  const { allowed, omittedByClass } = authorizeHits({
    scored,
    suppressed: suppressedClaimIds(resolutions),
    principal: input.principal,
    authz: input.authz,
  });

  allowed.sort((left, right) => right.score - left.score);
  const ordered = await maybeRerank({
    allowed,
    reranker: input.reranker,
    rerank: plan.rerank,
    query: input.query,
  });

  const hits = ordered.slice(0, plan.budget);
  const omitted: RetrievalOmission[] = [...omittedByClass.entries()].map(
    ([classification, count]) => ({
      reason: 'policy_filter',
      classification,
      count,
    }),
  );
  const namespaceId = input.principal.namespaceIds[0];
  if (namespaceId === undefined) {
    throw new Error('Principal has no namespace');
  }
  const receipt: RetrievalReceipt = {
    id: newId('RetrievalReceiptId'),
    tenantId: input.principal.tenantId,
    namespaceId,
    principalId: input.principal.id,
    classification: 'internal',
    visibility: 'workspace',
    policyTags: input.purpose === undefined ? [] : [input.purpose],
    queryHash: createHash('sha256').update(input.query).digest('hex'),
    ...(input.purpose === undefined ? {} : { purpose: input.purpose }),
    temporal,
    planVersion: RETRIEVAL_PLAN_VERSION,
    selected: hits.map((hit) => ({
      claimId: hit.claim.id,
      evidenceIds: hit.evidenceIds,
      score: hit.score,
      scoreComponents: hit.scoreComponents,
    })),
    omissions: omitted,
    executedAt: nowIso(),
    provenance: compactProvenance({
      source: 'retrieval',
      actor: input.principal.id,
      process: 'knowledge.retrieve',
    }),
  };
  await input.store.putRetrievalReceipt(receipt);

  return { hits, omitted, plan, receipt };
}
