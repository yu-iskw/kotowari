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

export type ProjectionServingSnapshot = RetrievalProjectionStatus & {
  ready: boolean;
  healthy: boolean;
  checkedAt: string;
  lastError?: string;
  projectionSearches: number;
  canonicalFallbacks: number;
  projectionErrors: number;
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
  return claim.object.kind === 'entity'
    ? [claim.subject, claim.object.entityId]
    : [claim.subject];
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
    const claims = await store.searchLexical({ ...filter, query: request.query, limit: request.limit });
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
  const vector = request.queryVector ?? (await embeddings.embed({ texts: [request.query] })).vectors[0] ?? [];
  const byClaim = new Map(storedEmbeddings.map((row) => [row.claimId, row.vector]));
  return claims
    .map((claim) => ({ claimId: claim.id, score: cosine(vector, byClaim.get(claim.id) ?? []) }))
    .filter((candidate) => candidate.score >= 0.15)
    .sort((left, right) => right.score - left.score)
    .slice(0, request.limit);
}

export function createProjectionServingGate(input: {
  projection: PostgresRetrievalProjection;
  store: CanonicalStore;
  embeddings: EmbeddingProvider;
  now?: () => Date;
}): ProjectionServingGate {
  const now = input.now ?? (() => new Date());
  let projectionSearches = 0;
  let canonicalFallbacks = 0;
  let projectionErrors = 0;
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
        canonicalFallbacks,
        projectionErrors,
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
        canonicalFallbacks,
        projectionErrors,
        lastError,
        ...(lastFallbackReason === undefined ? {} : { lastFallbackReason }),
      };
    }
  };

  const candidateSource: RetrievalCandidateSource = {
    id: 'postgres-retrieval-failsafe-v1',
    async search(request) {
      const snapshot = await status();
      if (!snapshot.ready || !snapshot.healthy) {
        canonicalFallbacks += 1;
        lastFallbackReason = 'unavailable';
        return canonicalSearch(input.store, input.embeddings, request);
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
        return canonicalSearch(input.store, input.embeddings, request);
      }
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
        '# HELP kotowari_projection_searches_total Candidate searches served by the projection.',
        '# TYPE kotowari_projection_searches_total counter',
        `kotowari_projection_searches_total ${String(snapshot.projectionSearches)}`,
        '# HELP kotowari_projection_canonical_fallbacks_total Candidate searches served canonically.',
        '# TYPE kotowari_projection_canonical_fallbacks_total counter',
        `kotowari_projection_canonical_fallbacks_total ${String(snapshot.canonicalFallbacks)}`,
        '# HELP kotowari_projection_errors_total Projection serving failures.',
        '# TYPE kotowari_projection_errors_total counter',
        `kotowari_projection_errors_total ${String(snapshot.projectionErrors)}`,
        '',
      ].join('\n');
    },
  };
}
