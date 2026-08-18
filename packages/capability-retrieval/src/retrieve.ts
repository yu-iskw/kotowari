import { createHash } from 'node:crypto';

import {
  allowWithReceipt,
  claimText,
  compactProvenance,
  newId,
  normalizeTemporalPerspective,
  nowIso,
} from '@kotowari/kernel';

import { reciprocalRankFuse } from './fusion.js';

import type {
  AuthContext,
  AuthorizationReceipt,
  Claim,
  ConflictResolution,
  EvidenceId,
  Principal,
  RetrievalReceipt,
  TemporalPerspective,
} from '@kotowari/kernel';
import type {
  CanonicalStore,
  EmbeddingProvider,
  RerankerProvider,
  RetrievalCandidateSource,
  RetrievalCandidateStrategy,
} from '@kotowari/plugin-sdk';

export type RetrievalPlan = {
  candidates: readonly (
    | { strategy: 'lexical'; limit: number }
    | { strategy: 'vector'; limit: number }
    | { strategy: 'graph'; hops: number }
  )[];
  rerank: string;
  budget: number;
  explain: boolean;
  fusion?: { strategy: 'rrf'; k: number };
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
  fusion: { strategy: 'rrf', k: 60 },
};

export const RETRIEVAL_PLAN_VERSION = 'retrieval-v2' as const;

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
    components.graph === undefined ? undefined : 'graph neighborhood',
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
    ...(graphRoute === undefined ? {} : { graphRoute }),
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
}): {
  allowed: RetrievalHit[];
  omittedByClass: Map<string, number>;
  receipts: AuthorizationReceipt[];
} {
  const omittedByClass = new Map<string, number>();
  const allowed: RetrievalHit[] = [];
  const receipts: AuthorizationReceipt[] = [];
  for (const hit of input.scored.values()) {
    if (input.suppressed.has(hit.claimId)) {
      continue;
    }
    const { decision, receipt } = allowWithReceipt(
      input.principal,
      'knowledge.read',
      { kind: 'claim', id: hit.claimId, metadata: hit.claim },
      input.authz,
    );
    receipts.push(receipt);
    if (decision.effect === 'deny') {
      const classification = hit.claim.classification;
      omittedByClass.set(classification, (omittedByClass.get(classification) ?? 0) + 1);
      continue;
    }
    allowed.push(hit);
  }
  return { allowed, omittedByClass, receipts };
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

async function fallbackCandidates(input: {
  store: CanonicalStore;
  embeddings: EmbeddingProvider;
  principal: Principal;
  query: string;
  temporal: TemporalPerspective;
  plan: RetrievalPlan;
}): Promise<Map<string, RetrievalHit>> {
  const filter = {
    tenantId: input.principal.tenantId,
    namespaceId: input.principal.namespaceIds[0],
    temporal: input.temporal,
  };
  const [claims, embeddings, queryEmbedding, lexicalClaims] = await Promise.all([
    input.store.listClaims(filter),
    input.store.listEmbeddings(),
    input.embeddings.embed({ texts: [input.query] }),
    input.store.searchLexical({ ...filter, query: input.query, limit: lexicalLimit(input.plan) }),
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
    .map((claim) => ({ claim, vector: cosine(queryVector, embeddingByClaim.get(claim.id) ?? []) }))
    .filter((row) => row.vector >= 0.15)
    .sort((left, right) => right.vector - left.vector)
    .slice(0, vectorLimit(input.plan));
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

  const hops = graphHops(input.plan);
  if (hops > 0) {
    expandGraphNeighborhood(claims, scored, hops);
  }
  return scored;
}

function candidateLimit(plan: RetrievalPlan, strategy: RetrievalCandidateStrategy): number {
  if (strategy === 'lexical') {
    return lexicalLimit(plan);
  }
  if (strategy === 'vector') {
    return vectorLimit(plan);
  }
  return Math.max(plan.budget * 2, 20);
}

async function indexedCandidates(input: {
  source: RetrievalCandidateSource;
  store: CanonicalStore;
  embeddings: EmbeddingProvider;
  principal: Principal;
  query: string;
  temporal: TemporalPerspective;
  plan: RetrievalPlan;
}): Promise<Map<string, RetrievalHit>> {
  const namespaceId = input.principal.namespaceIds[0];
  const queryEmbedding = await input.embeddings.embed({ texts: [input.query] });
  const queryVector = queryEmbedding.vectors[0] ?? [];
  const base = {
    tenantId: input.principal.tenantId,
    ...(namespaceId === undefined ? {} : { namespaceId }),
    temporal: input.temporal,
    query: input.query,
  };
  const primaryPlans = input.plan.candidates.filter((candidate) => candidate.strategy !== 'graph');
  const primaryLists = await Promise.all(
    primaryPlans.map(async (candidate) => ({
      strategy: candidate.strategy,
      candidates: await input.source.search({
        ...base,
        strategy: candidate.strategy,
        limit: candidateLimit(input.plan, candidate.strategy),
        ...(candidate.strategy === 'vector' ? { queryVector } : {}),
      }),
    })),
  );
  const seedClaimIds = primaryLists.flatMap((list) => list.candidates.map((item) => item.claimId));
  const hops = graphHops(input.plan);
  const graphList =
    hops === 0 || seedClaimIds.length === 0
      ? []
      : [
          {
            strategy: 'graph' as const,
            candidates: await input.source.search({
              ...base,
              strategy: 'graph',
              limit: candidateLimit(input.plan, 'graph'),
              seedClaimIds,
              hops,
            }),
          },
        ];
  const fused = reciprocalRankFuse(
    [...primaryLists, ...graphList],
    input.plan.fusion?.k ?? DEFAULT_RETRIEVAL_PLAN.fusion?.k,
  );
  const hydrated = await Promise.all(
    fused.map(async (candidate) => ({ candidate, claim: await input.store.getClaim(candidate.claimId) })),
  );
  const scored = new Map<string, RetrievalHit>();
  for (const item of hydrated) {
    if (item.claim === undefined) {
      continue;
    }
    const components = item.candidate.scoreComponents;
    scored.set(
      item.claim.id,
      hitFromClaim(
        item.claim,
        item.candidate.score,
        {
          ...(components.lexical === undefined ? {} : { lexical: components.lexical }),
          ...(components.vector === undefined ? {} : { vector: components.vector }),
          ...(components.graph === undefined ? {} : { graph: components.graph }),
        },
        item.candidate.graphRoute,
      ),
    );
  }
  return scored;
}

export async function retrieve(input: {
  store: CanonicalStore;
  embeddings: EmbeddingProvider;
  candidateSource?: RetrievalCandidateSource;
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
  const [scored, resolutions] = await Promise.all([
    input.candidateSource === undefined
      ? fallbackCandidates({
          store: input.store,
          embeddings: input.embeddings,
          principal: input.principal,
          query: input.query,
          temporal,
          plan,
        })
      : indexedCandidates({
          source: input.candidateSource,
          store: input.store,
          embeddings: input.embeddings,
          principal: input.principal,
          query: input.query,
          temporal,
          plan,
        }),
    input.store.listResolutions({ tenantId: input.principal.tenantId }),
  ]);

  const { allowed, omittedByClass, receipts } = authorizeHits({
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
    ([classification, count]) => ({ reason: 'policy_filter', classification, count }),
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
    authorizationReceipts: receipts,
    executedAt: nowIso(),
    provenance: compactProvenance({
      source: input.candidateSource?.id ?? 'retrieval',
      actor: input.principal.id,
      process: 'knowledge.retrieve',
    }),
  };
  await input.store.putRetrievalReceipt(receipt);

  return { hits, omitted, plan, receipt };
}
