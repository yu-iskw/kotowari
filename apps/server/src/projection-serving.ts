import { claimText } from '@kotowari/plugin-sdk';

import type {
  PostgresRetrievalProjection,
  RetrievalProjectionStatus,
} from '@kotowari/adapter-postgres';
import type {
  CanonicalStore,
  Claim,
  EmbeddingProvider,
  RetrievalCandidate,
  RetrievalCandidateRequest,
  RetrievalCandidateSource,
} from '@kotowari/plugin-sdk';

export type VectorRolloutMode = 'disabled' | 'shadow' | 'canary' | 'enabled';

export type VectorRolloutPolicy = {
  mode: VectorRolloutMode;
  canaryPercent?: number;
};

export type ProjectionServingSnapshot = RetrievalProjectionStatus & {
  ready: boolean;
  healthy: boolean;
  checkedAt: string;
  lastError?: string;
  projectionSearches: number;
  canonicalSearches: number;
  canonicalFallbacks: number;
  projectionErrors: number;
  vectorRolloutMode: VectorRolloutMode;
  vectorCanaryPercent: number;
  vectorRolloutBypasses: number;
  vectorCanarySelections: number;
  vectorShadowSearches: number;
  vectorShadowMismatches: number;
  lastFallbackReason?: 'unavailable' | 'error';
};

export type ProjectionServingGate = {
  candidateSource: RetrievalCandidateSource;
  status(): Promise<ProjectionServingSnapshot>;
  metrics(): Promise<string>;
};

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 1);
}

function cosine(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  if (length === 0) return 0;
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
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

function connectedEntityIds(claim: Claim): readonly string[] {
  return claim.object.kind === 'entity' ? [claim.subject, claim.object.entityId] : [claim.subject];
}

async function canonicalGraphSearch(
  store: CanonicalStore,
  request: RetrievalCandidateRequest,
): Promise<readonly RetrievalCandidate[]> {
  const claims = await store.listClaims({
    tenantId: request.tenantId,
    ...(request.namespaceId === undefined ? {} : { namespaceId: request.namespaceId }),
    ...(request.temporal === undefined ? {} : { temporal: request.temporal }),
  });
  const byId = new Map(claims.map((claim) => [claim.id, claim]));
  const seeds = (request.seedClaimIds ?? [])
    .map((id) => byId.get(id))
    .filter((claim): claim is Claim => claim !== undefined);
  let frontier = new Set(seeds.flatMap(connectedEntityIds));
  const seen = new Set(request.seedClaimIds ?? []);
  const candidates = new Map<string, RetrievalCandidate>();
  const hops = Math.max(0, request.hops ?? 0);
  for (let hop = 1; hop <= hops; hop += 1) {
    const next = new Set<string>();
    for (const claim of claims) {
      const ids = connectedEntityIds(claim);
      if (!ids.some((id) => frontier.has(id))) continue;
      for (const id of ids) next.add(id);
      if (!seen.has(claim.id)) {
        seen.add(claim.id);
        candidates.set(claim.id, {
          claimId: claim.id,
          score: 1 / hop,
          graphRoute: [claim.subject],
        });
      }
    }
    frontier = next;
  }
  return [...candidates.values()].slice(0, request.limit);
}

async function canonicalSearch(
  store: CanonicalStore,
  embeddings: EmbeddingProvider,
  request: RetrievalCandidateRequest,
): Promise<readonly RetrievalCandidate[]> {
  const filter = {
    tenantId: request.tenantId,
    ...(request.namespaceId === undefined ? {} : { namespaceId: request.namespaceId }),
    ...(request.temporal === undefined ? {} : { temporal: request.temporal }),
  };
  if (request.strategy === 'lexical') {
    const queryTokens = tokenize(request.query);
    const claims = await store.searchLexical({
      ...filter,
      query: request.query,
      limit: request.limit,
    });
    return claims.map((claim) => ({
      claimId: claim.id,
      score: queryTokens.filter((token) => claimText(claim).toLowerCase().includes(token)).length,
    }));
  }
  if (request.strategy === 'graph') {
    return canonicalGraphSearch(store, request);
  }
  const [claims, storedEmbeddings] = await Promise.all([
    store.listClaims(filter),
    store.listEmbeddings(),
  ]);
  const vector =
    request.queryVector ?? (await embeddings.embed({ texts: [request.query] })).vectors[0] ?? [];
  const byClaim = new Map(storedEmbeddings.map((row) => [row.claimId, row.vector]));
  return claims
    .map((claim) => ({
      claimId: claim.id,
      score: cosine(vector, byClaim.get(claim.id) ?? []),
    }))
    .filter((candidate) => candidate.score >= 0.15)
    .sort((left, right) => right.score - left.score)
    .slice(0, request.limit);
}

function normalizeVectorRolloutPolicy(policy: VectorRolloutPolicy | undefined): Required<VectorRolloutPolicy> {
  const mode = policy?.mode ?? 'enabled';
  const canaryPercent = policy?.canaryPercent ?? 5;
  if (!Number.isInteger(canaryPercent) || canaryPercent < 1 || canaryPercent > 100) {
    throw new Error('Vector rollout canaryPercent must be an integer from 1 through 100');
  }
  return { mode, canaryPercent };
}

function rolloutBucket(request: RetrievalCandidateRequest): number {
  const key = [
    request.tenantId,
    request.namespaceId ?? '',
    request.strategy,
    request.query,
  ].join('\u0000');
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash % 100;
}

function sameCandidateIds(
  left: readonly RetrievalCandidate[],
  right: readonly RetrievalCandidate[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((candidate, index) => candidate.claimId === right[index]?.claimId);
}

export function createProjectionServingGate(input: {
  projection: PostgresRetrievalProjection;
  store: CanonicalStore;
  embeddings: EmbeddingProvider;
  vectorRollout?: VectorRolloutPolicy;
  now?: () => Date;
}): ProjectionServingGate {
  const now = input.now ?? (() => new Date());
  const vectorRollout = normalizeVectorRolloutPolicy(input.vectorRollout);
  let projectionSearches = 0;
  let canonicalSearches = 0;
  let canonicalFallbacks = 0;
  let projectionErrors = 0;
  let vectorRolloutBypasses = 0;
  let vectorCanarySelections = 0;
  let vectorShadowSearches = 0;
  let vectorShadowMismatches = 0;
  let lastError: string | undefined;
  let lastFallbackReason: 'unavailable' | 'error' | undefined;

  const status = async (): Promise<ProjectionServingSnapshot> => {
    const checkedAt = now().toISOString();
    try {
      const raw = await input.projection.status();
      const ready = !raw.stale && raw.pendingEvents === 0;
      return {
        ...raw,
        ready,
        healthy: ready && lastError === undefined,
        checkedAt,
        projectionSearches,
        canonicalSearches,
        canonicalFallbacks,
        projectionErrors,
        vectorRolloutMode: vectorRollout.mode,
        vectorCanaryPercent: vectorRollout.canaryPercent,
        vectorRolloutBypasses,
        vectorCanarySelections,
        vectorShadowSearches,
        vectorShadowMismatches,
        ...(lastError === undefined ? {} : { lastError }),
        ...(lastFallbackReason === undefined ? {} : { lastFallbackReason }),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      return {
        projectionId: input.projection.id,
        pendingEvents: 0,
        stale: true,
        ready: false,
        healthy: false,
        checkedAt,
        projectionSearches,
        canonicalSearches,
        canonicalFallbacks,
        projectionErrors,
        vectorRolloutMode: vectorRollout.mode,
        vectorCanaryPercent: vectorRollout.canaryPercent,
        vectorRolloutBypasses,
        vectorCanarySelections,
        vectorShadowSearches,
        vectorShadowMismatches,
        lastError,
        ...(lastFallbackReason === undefined ? {} : { lastFallbackReason }),
      };
    }
  };

  const searchCanonical = async (
    request: RetrievalCandidateRequest,
  ): Promise<readonly RetrievalCandidate[]> => {
    canonicalSearches += 1;
    return canonicalSearch(input.store, input.embeddings, request);
  };

  const searchProjectionWithFallback = async (
    request: RetrievalCandidateRequest,
  ): Promise<readonly RetrievalCandidate[]> => {
    const snapshot = await status();
    if (!snapshot.ready || !snapshot.healthy) {
      canonicalFallbacks += 1;
      lastFallbackReason = 'unavailable';
      return searchCanonical(request);
    }
    try {
      const candidates = await input.projection.search(request);
      projectionSearches += 1;
      lastError = undefined;
      return candidates;
    } catch (error) {
      projectionErrors += 1;
      canonicalFallbacks += 1;
      lastFallbackReason = 'error';
      lastError = error instanceof Error ? error.message : String(error);
      return searchCanonical(request);
    }
  };

  const searchVector = async (
    request: RetrievalCandidateRequest,
  ): Promise<readonly RetrievalCandidate[]> => {
    if (vectorRollout.mode === 'disabled') {
      vectorRolloutBypasses += 1;
      return searchCanonical(request);
    }
    if (vectorRollout.mode === 'shadow') {
      vectorRolloutBypasses += 1;
      const canonical = await searchCanonical(request);
      const snapshot = await status();
      if (!snapshot.ready || !snapshot.healthy) {
        return canonical;
      }
      try {
        const shadow = await input.projection.search(request);
        projectionSearches += 1;
        vectorShadowSearches += 1;
        lastError = undefined;
        if (!sameCandidateIds(canonical, shadow)) {
          vectorShadowMismatches += 1;
        }
      } catch (error) {
        projectionErrors += 1;
        lastError = error instanceof Error ? error.message : String(error);
      }
      return canonical;
    }
    if (vectorRollout.mode === 'canary') {
      if (rolloutBucket(request) >= vectorRollout.canaryPercent) {
        vectorRolloutBypasses += 1;
        return searchCanonical(request);
      }
      vectorCanarySelections += 1;
    }
    return searchProjectionWithFallback(request);
  };

  const candidateSource: RetrievalCandidateSource = {
    id: 'postgres-retrieval-failsafe-v1',
    async search(request) {
      if (request.strategy === 'vector') {
        return searchVector(request);
      }
      return searchProjectionWithFallback(request);
    },
  };

  return {
    candidateSource,
    status,
    async metrics() {
      const snapshot = await status();
      return [
        '# HELP kotowari_projection_ready Whether the retrieval projection is safe to serve.',
        '# TYPE kotowari_projection_ready gauge',
        `kotowari_projection_ready ${snapshot.ready ? '1' : '0'}`,
        '# HELP kotowari_projection_pending_events Canonical events not yet projected.',
        '# TYPE kotowari_projection_pending_events gauge',
        `kotowari_projection_pending_events ${String(snapshot.pendingEvents)}`,
        '# HELP kotowari_projection_searches_total Candidate searches executed by the projection.',
        '# TYPE kotowari_projection_searches_total counter',
        `kotowari_projection_searches_total ${String(snapshot.projectionSearches)}`,
        '# HELP kotowari_projection_canonical_searches_total Candidate searches executed canonically.',
        '# TYPE kotowari_projection_canonical_searches_total counter',
        `kotowari_projection_canonical_searches_total ${String(snapshot.canonicalSearches)}`,
        '# HELP kotowari_projection_canonical_fallbacks_total Projection searches rolled back canonically.',
        '# TYPE kotowari_projection_canonical_fallbacks_total counter',
        `kotowari_projection_canonical_fallbacks_total ${String(snapshot.canonicalFallbacks)}`,
        '# HELP kotowari_projection_errors_total Projection serving failures.',
        '# TYPE kotowari_projection_errors_total counter',
        `kotowari_projection_errors_total ${String(snapshot.projectionErrors)}`,
        '# HELP kotowari_vector_rollout_mode Current vector rollout mode.',
        '# TYPE kotowari_vector_rollout_mode gauge',
        `kotowari_vector_rollout_mode{mode="${snapshot.vectorRolloutMode}"} 1`,
        '# HELP kotowari_vector_rollout_bypasses_total Vector requests intentionally kept canonical by rollout policy.',
        '# TYPE kotowari_vector_rollout_bypasses_total counter',
        `kotowari_vector_rollout_bypasses_total ${String(snapshot.vectorRolloutBypasses)}`,
        '# HELP kotowari_vector_canary_selections_total Vector requests selected for projection canary serving.',
        '# TYPE kotowari_vector_canary_selections_total counter',
        `kotowari_vector_canary_selections_total ${String(snapshot.vectorCanarySelections)}`,
        '# HELP kotowari_vector_shadow_searches_total Projection vector searches executed in shadow mode.',
        '# TYPE kotowari_vector_shadow_searches_total counter',
        `kotowari_vector_shadow_searches_total ${String(snapshot.vectorShadowSearches)}`,
        '# HELP kotowari_vector_shadow_mismatches_total Shadow vector searches whose ordered candidate IDs differed from canonical.',
        '# TYPE kotowari_vector_shadow_mismatches_total counter',
        `kotowari_vector_shadow_mismatches_total ${String(snapshot.vectorShadowMismatches)}`,
        '',
      ].join('\n');
    },
  };
}
