import { allow } from '@kotowari/kernel';

import type { AuthContext, Claim, ConflictResolution, EvidenceId, Principal } from '@kotowari/kernel';
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
};

type GraphCandidate = Extract<RetrievalPlan['candidates'][number], { strategy: 'graph' }>;

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

function claimBlob(claim: Claim): string {
  const object = claim.object.kind === 'literal' ? claim.object.value : claim.object.entityId;
  return `${claim.predicate} ${object}`;
}

function isGraphCandidate(candidate: RetrievalPlan['candidates'][number]): candidate is GraphCandidate {
  return candidate.strategy === 'graph';
}

function scoreClaims(
  claims: readonly Claim[],
  queryTokens: string[],
  queryVector: readonly number[],
  embeddingByClaim: ReadonlyMap<string, readonly number[]>,
): Map<string, RetrievalHit> {
  const scored = new Map<string, RetrievalHit>();
  for (const claim of claims) {
    const blob = claimBlob(claim);
    const lexical = queryTokens.filter((token) => blob.toLowerCase().includes(token)).length;
    const vector = cosine(queryVector, embeddingByClaim.get(claim.id) ?? []);
    if (lexical === 0 && vector < 0.15 && queryTokens.length > 0) {
      continue;
    }
    scored.set(claim.id, {
      claimId: claim.id,
      score: lexical + vector,
      scoreComponents: {
        ...(lexical > 0 ? { lexical } : {}),
        ...(vector > 0 ? { vector } : {}),
      },
      evidenceIds: claim.evidenceIds,
      policy: { passed: true },
      whySelected: 'pending',
      claim,
    });
  }
  return scored;
}

function expandGraphNeighborhood(claims: readonly Claim[], scored: Map<string, RetrievalHit>): void {
  const seedIds = [...scored.keys()];
  const entityIds = new Set(
    claims.filter((claim) => seedIds.includes(claim.id)).map((claim) => claim.subject),
  );
  for (const claim of claims) {
    if (entityIds.has(claim.subject) && !scored.has(claim.id)) {
      scored.set(claim.id, {
        claimId: claim.id,
        score: 0.3,
        scoreComponents: { graph: 0.3 },
        evidenceIds: claim.evidenceIds,
        graphRoute: [claim.subject],
        policy: { passed: true },
        whySelected: 'pending',
        claim,
      });
    }
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
  purpose: string | undefined;
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
      { ...input.authz, purpose: input.purpose ?? input.authz.purpose },
    );
    if (decision.effect === 'deny') {
      const classification = hit.claim.classification;
      omittedByClass.set(classification, (omittedByClass.get(classification) ?? 0) + 1);
      continue;
    }
    const why = [
      hit.scoreComponents.lexical === undefined ? undefined : `lexical ${String(hit.scoreComponents.lexical)}`,
      hit.scoreComponents.vector === undefined
        ? undefined
        : `vector ${hit.scoreComponents.vector.toFixed(2)}`,
      hit.scoreComponents.graph === undefined ? undefined : `graph neighborhood`,
    ]
      .filter((part) => part !== undefined)
      .join('; ');
    allowed.push({
      ...hit,
      whySelected: why.length > 0 ? why : 'metadata match',
    });
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
      hits: input.allowed.map((hit) => ({ id: hit.claimId, text: claimBlob(hit.claim) })),
    });
    const byId = new Map(input.allowed.map((hit) => [hit.claimId, hit]));
    return reranked.ids.map((id) => byId.get(id)).filter((hit) => hit !== undefined);
  }
  return input.allowed;
}

export async function retrieve(input: {
  store: CanonicalStore;
  embeddings: EmbeddingProvider;
  reranker?: RerankerProvider;
  principal: Principal;
  authz: AuthContext;
  query: string;
  asOf?: string;
  purpose?: string;
  plan?: RetrievalPlan;
}): Promise<RetrievalResult> {
  const plan = input.plan ?? DEFAULT_RETRIEVAL_PLAN;
  const claims = await input.store.listClaims({
    tenantId: input.principal.tenantId,
    namespaceId: input.principal.namespaceIds[0],
    asOf: input.asOf,
  });
  const embeddings = await input.store.listEmbeddings();
  const embeddingByClaim = new Map(embeddings.map((row) => [row.claimId, row.vector]));
  const queryTokens = tokenize(input.query);
  const queryVector = (await input.embeddings.embed({ texts: [input.query] })).vectors[0] ?? [];
  const graphHops = plan.candidates.find(isGraphCandidate);

  const scored = scoreClaims(claims, queryTokens, queryVector, embeddingByClaim);

  if (graphHops !== undefined) {
    expandGraphNeighborhood(claims, scored);
  }

  const resolutions = await input.store.listResolutions({ tenantId: input.principal.tenantId });
  const { allowed, omittedByClass } = authorizeHits({
    scored,
    suppressed: suppressedClaimIds(resolutions),
    principal: input.principal,
    authz: input.authz,
    purpose: input.purpose,
  });

  allowed.sort((left, right) => right.score - left.score);
  const ordered = await maybeRerank({
    allowed,
    reranker: input.reranker,
    rerank: plan.rerank,
    query: input.query,
  });

  const hits = ordered.slice(0, plan.budget);
  const omitted: RetrievalOmission[] = [...omittedByClass.entries()].map(([classification, count]) => ({
    reason: 'policy_filter',
    classification,
    count,
  }));

  return { hits, omitted, plan };
}
