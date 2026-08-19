import { claimText } from '@kotowari/plugin-sdk';

import { stableCanarySample } from './retrieval-rollout.js';

import type { RetrievalRolloutMode, RetrievalRolloutPolicy } from './retrieval-rollout.js';

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

const DEFAULT_ROLLOUT_POLICY: RetrievalRolloutPolicy = {
  mode: 'enabled',
  canaryPercent: 10,
  maxConsecutiveErrors: 3,
};
const LATENCY_BUCKETS_MS = [1, 5, 10, 25, 50, 100, 250, 500, 1_000, 2_500] as const;

type LatencyHistogram = {
  count: number;
  sumMs: number;
  buckets: number[];
};

export type ProjectionServingSnapshot = RetrievalProjectionStatus & {
  ready: boolean;
  servingReady: boolean;
  healthy: boolean;
  checkedAt: string;
  desiredMode: RetrievalRolloutMode;
  effectiveMode: RetrievalRolloutMode;
  canaryPercent: number;
  rollbackActive: boolean;
  consecutiveProjectionErrors: number;
  lastError?: string;
  projectionSearches: number;
  projectionServedSearches: number;
  canonicalSearches: number;
  canonicalFallbacks: number;
  projectionErrors: number;
  shadowComparisons: number;
  shadowMismatches: number;
  lastFallbackReason?: 'unavailable' | 'error' | 'rollback';
  rollbackReason?: 'consecutive-errors';
};

export type ProjectionServingGate = {
  candidateSource: RetrievalCandidateSource;
  status(): Promise<ProjectionServingSnapshot>;
  metrics(): Promise<string>;
  resetRollback(): void;
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

function createHistogram(): LatencyHistogram {
  return { count: 0, sumMs: 0, buckets: LATENCY_BUCKETS_MS.map(() => 0) };
}

function observeLatency(histogram: LatencyHistogram, durationMs: number): void {
  histogram.count += 1;
  histogram.sumMs += durationMs;
  for (let index = 0; index < LATENCY_BUCKETS_MS.length; index += 1) {
    const bound = LATENCY_BUCKETS_MS[index];
    if (bound !== undefined && durationMs <= bound)
      histogram.buckets[index] = (histogram.buckets[index] ?? 0) + 1;
  }
}

function histogramMetrics(name: string, help: string, histogram: LatencyHistogram): string[] {
  const lines = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`];
  for (let index = 0; index < LATENCY_BUCKETS_MS.length; index += 1) {
    lines.push(
      `${name}_bucket{le="${String(LATENCY_BUCKETS_MS[index])}"} ${String(histogram.buckets[index] ?? 0)}`,
    );
  }
  lines.push(`${name}_bucket{le="+Inf"} ${String(histogram.count)}`);
  lines.push(`${name}_sum ${String(histogram.sumMs)}`);
  lines.push(`${name}_count ${String(histogram.count)}`);
  return lines;
}

function sameCandidateOrder(
  left: readonly RetrievalCandidate[],
  right: readonly RetrievalCandidate[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((candidate, index) => candidate.claimId === right[index]?.claimId);
}

function canaryKey(request: RetrievalCandidateRequest): string {
  return [
    String(request.tenantId),
    request.namespaceId === undefined ? '' : String(request.namespaceId),
    request.strategy,
    request.query,
  ].join('|');
}

export function createProjectionServingGate(input: {
  projection: PostgresRetrievalProjection;
  store: CanonicalStore;
  embeddings: EmbeddingProvider;
  policy?: RetrievalRolloutPolicy;
  now?: () => Date;
  monotonicNowMs?: () => number;
  sample?: (request: RetrievalCandidateRequest) => number;
}): ProjectionServingGate {
  const now = input.now ?? (() => new Date());
  const monotonicNowMs = input.monotonicNowMs ?? (() => performance.now());
  const policy = input.policy ?? DEFAULT_ROLLOUT_POLICY;
  const sample =
    input.sample ??
    ((request: RetrievalCandidateRequest) => stableCanarySample(canaryKey(request)));
  let projectionSearches = 0;
  let projectionServedSearches = 0;
  let canonicalSearches = 0;
  let canonicalFallbacks = 0;
  let projectionErrors = 0;
  let shadowComparisons = 0;
  let shadowMismatches = 0;
  let consecutiveProjectionErrors = 0;
  let rollbackActive = false;
  let lastError: string | undefined;
  let lastFallbackReason: 'unavailable' | 'error' | 'rollback' | undefined;
  let rollbackReason: 'consecutive-errors' | undefined;
  const projectionLatency = createHistogram();
  const canonicalLatency = createHistogram();

  const effectiveMode = (): RetrievalRolloutMode => (rollbackActive ? 'disabled' : policy.mode);

  const status = async (): Promise<ProjectionServingSnapshot> => {
    const checkedAt = now().toISOString();
    const mode = effectiveMode();
    try {
      const raw = await input.projection.status();
      const ready = !raw.stale && raw.pendingEvents === 0;
      const servingReady = mode === 'disabled' || mode === 'shadow' || ready;
      return {
        ...raw,
        ready,
        servingReady,
        healthy: servingReady && !rollbackActive,
        checkedAt,
        desiredMode: policy.mode,
        effectiveMode: mode,
        canaryPercent: policy.canaryPercent,
        rollbackActive,
        consecutiveProjectionErrors,
        projectionSearches,
        projectionServedSearches,
        canonicalSearches,
        canonicalFallbacks,
        projectionErrors,
        shadowComparisons,
        shadowMismatches,
        ...(lastError === undefined ? {} : { lastError }),
        ...(lastFallbackReason === undefined ? {} : { lastFallbackReason }),
        ...(rollbackReason === undefined ? {} : { rollbackReason }),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      const servingReady = mode === 'disabled' || mode === 'shadow';
      return {
        projectionId: input.projection.id,
        pendingEvents: 0,
        stale: true,
        ready: false,
        servingReady,
        healthy: servingReady && !rollbackActive,
        checkedAt,
        desiredMode: policy.mode,
        effectiveMode: mode,
        canaryPercent: policy.canaryPercent,
        rollbackActive,
        consecutiveProjectionErrors,
        projectionSearches,
        projectionServedSearches,
        canonicalSearches,
        canonicalFallbacks,
        projectionErrors,
        shadowComparisons,
        shadowMismatches,
        lastError,
        ...(lastFallbackReason === undefined ? {} : { lastFallbackReason }),
        ...(rollbackReason === undefined ? {} : { rollbackReason }),
      };
    }
  };

  const runCanonical = async (
    request: RetrievalCandidateRequest,
  ): Promise<readonly RetrievalCandidate[]> => {
    const startedAt = monotonicNowMs();
    try {
      return await canonicalSearch(input.store, input.embeddings, request);
    } finally {
      canonicalSearches += 1;
      observeLatency(canonicalLatency, Math.max(0, monotonicNowMs() - startedAt));
    }
  };

  const runProjection = async (
    request: RetrievalCandidateRequest,
  ): Promise<readonly RetrievalCandidate[]> => {
    const startedAt = monotonicNowMs();
    try {
      const candidates = await input.projection.search(request);
      projectionSearches += 1;
      consecutiveProjectionErrors = 0;
      lastError = undefined;
      return candidates;
    } catch (error) {
      projectionErrors += 1;
      consecutiveProjectionErrors += 1;
      lastError = error instanceof Error ? error.message : String(error);
      if (consecutiveProjectionErrors >= policy.maxConsecutiveErrors) {
        rollbackActive = true;
        rollbackReason = 'consecutive-errors';
      }
      throw error;
    } finally {
      observeLatency(projectionLatency, Math.max(0, monotonicNowMs() - startedAt));
    }
  };

  const candidateSource: RetrievalCandidateSource = {
    id: 'postgres-retrieval-failsafe-v2',
    async search(request) {
      const mode = effectiveMode();
      if (mode === 'disabled') {
        if (rollbackActive) {
          canonicalFallbacks += 1;
          lastFallbackReason = 'rollback';
        }
        return runCanonical(request);
      }

      const snapshot = await status();
      if (mode === 'shadow') {
        const canonicalCandidates = await runCanonical(request);
        if (!snapshot.ready) return canonicalCandidates;
        try {
          const projectionCandidates = await runProjection(request);
          shadowComparisons += 1;
          if (!sameCandidateOrder(canonicalCandidates, projectionCandidates)) shadowMismatches += 1;
        } catch {
          // Shadow failures never affect the serving path. Circuit-breaker state is still recorded.
        }
        return canonicalCandidates;
      }

      if (!snapshot.ready) {
        canonicalFallbacks += 1;
        lastFallbackReason = 'unavailable';
        return runCanonical(request);
      }

      if (mode === 'canary' && sample(request) >= policy.canaryPercent) {
        return runCanonical(request);
      }

      try {
        const candidates = await runProjection(request);
        projectionServedSearches += 1;
        return candidates;
      } catch {
        canonicalFallbacks += 1;
        lastFallbackReason = 'error';
        return runCanonical(request);
      }
    },
  };

  return {
    candidateSource,
    status,
    resetRollback() {
      rollbackActive = false;
      rollbackReason = undefined;
      consecutiveProjectionErrors = 0;
      lastError = undefined;
      lastFallbackReason = undefined;
    },
    async metrics() {
      const snapshot = await status();
      return [
        '# HELP kotowari_projection_ready Whether the retrieval projection itself is caught up.',
        '# TYPE kotowari_projection_ready gauge',
        `kotowari_projection_ready ${snapshot.ready ? '1' : '0'}`,
        '# HELP kotowari_retrieval_serving_ready Whether the configured retrieval serving path is ready.',
        '# TYPE kotowari_retrieval_serving_ready gauge',
        `kotowari_retrieval_serving_ready ${snapshot.servingReady ? '1' : '0'}`,
        '# HELP kotowari_retrieval_rollout_mode Configured retrieval rollout mode.',
        '# TYPE kotowari_retrieval_rollout_mode gauge',
        `kotowari_retrieval_rollout_mode{mode="${snapshot.desiredMode}"} 1`,
        '# HELP kotowari_retrieval_effective_mode Effective retrieval mode after safety controls.',
        '# TYPE kotowari_retrieval_effective_mode gauge',
        `kotowari_retrieval_effective_mode{mode="${snapshot.effectiveMode}"} 1`,
        '# HELP kotowari_retrieval_rollback_active Whether automatic projection rollback is active.',
        '# TYPE kotowari_retrieval_rollback_active gauge',
        `kotowari_retrieval_rollback_active ${snapshot.rollbackActive ? '1' : '0'}`,
        '# HELP kotowari_projection_pending_events Canonical events not yet projected.',
        '# TYPE kotowari_projection_pending_events gauge',
        `kotowari_projection_pending_events ${String(snapshot.pendingEvents)}`,
        '# HELP kotowari_projection_searches_total Candidate searches executed by the projection.',
        '# TYPE kotowari_projection_searches_total counter',
        `kotowari_projection_searches_total ${String(snapshot.projectionSearches)}`,
        '# HELP kotowari_projection_served_searches_total Candidate searches served from the projection.',
        '# TYPE kotowari_projection_served_searches_total counter',
        `kotowari_projection_served_searches_total ${String(snapshot.projectionServedSearches)}`,
        '# HELP kotowari_canonical_searches_total Candidate searches executed against canonical storage.',
        '# TYPE kotowari_canonical_searches_total counter',
        `kotowari_canonical_searches_total ${String(snapshot.canonicalSearches)}`,
        '# HELP kotowari_projection_canonical_fallbacks_total Projection-intended searches served canonically.',
        '# TYPE kotowari_projection_canonical_fallbacks_total counter',
        `kotowari_projection_canonical_fallbacks_total ${String(snapshot.canonicalFallbacks)}`,
        '# HELP kotowari_projection_errors_total Projection serving failures.',
        '# TYPE kotowari_projection_errors_total counter',
        `kotowari_projection_errors_total ${String(snapshot.projectionErrors)}`,
        '# HELP kotowari_projection_shadow_comparisons_total Shadow comparisons completed.',
        '# TYPE kotowari_projection_shadow_comparisons_total counter',
        `kotowari_projection_shadow_comparisons_total ${String(snapshot.shadowComparisons)}`,
        '# HELP kotowari_projection_shadow_mismatches_total Shadow comparisons with different ordered candidate IDs.',
        '# TYPE kotowari_projection_shadow_mismatches_total counter',
        `kotowari_projection_shadow_mismatches_total ${String(snapshot.shadowMismatches)}`,
        ...histogramMetrics(
          'kotowari_projection_search_latency_ms',
          'Projection candidate-search latency in milliseconds.',
          projectionLatency,
        ),
        ...histogramMetrics(
          'kotowari_canonical_search_latency_ms',
          'Canonical candidate-search latency in milliseconds.',
          canonicalLatency,
        ),
        '',
      ].join('\n');
    },
  };
}
