import type { ProjectionServingSnapshot } from './projection-serving.js';
import type { RetrievalRolloutMode } from './retrieval-rollout.js';

export type RetrievalRolloutSloPolicy = {
  minProjectionSamples: number;
  maxProjectionErrorRatio: number;
  maxCanonicalFallbackRatio: number;
  maxShadowMismatchRatio: number;
};

export type RetrievalRolloutSloVerdict = 'insufficient-data' | 'hold' | 'promote' | 'rollback';

export type RetrievalRolloutSloAssessment = {
  verdict: RetrievalRolloutSloVerdict;
  recommendedMode: RetrievalRolloutMode;
  projectionSamples: number;
  userSearches: number;
  projectionErrorRatio: number;
  canonicalFallbackRatio: number;
  shadowMismatchRatio: number;
  reasons: readonly string[];
  policy: RetrievalRolloutSloPolicy;
};

const DEFAULT_SLO_POLICY: RetrievalRolloutSloPolicy = {
  minProjectionSamples: 100,
  maxProjectionErrorRatio: 0.01,
  maxCanonicalFallbackRatio: 0.02,
  maxShadowMismatchRatio: 0.1,
};

function parsePositiveInt(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.length === 0) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseRatio(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value.length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    throw new Error(`${name} must be between 0 and 1`);
  }
  return parsed;
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

export function retrievalRolloutSloPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): RetrievalRolloutSloPolicy {
  return {
    minProjectionSamples: parsePositiveInt(
      'KOTOWARI_RETRIEVAL_SLO_MIN_PROJECTION_SAMPLES',
      env['KOTOWARI_RETRIEVAL_SLO_MIN_PROJECTION_SAMPLES'],
      DEFAULT_SLO_POLICY.minProjectionSamples,
    ),
    maxProjectionErrorRatio: parseRatio(
      'KOTOWARI_RETRIEVAL_SLO_MAX_PROJECTION_ERROR_RATIO',
      env['KOTOWARI_RETRIEVAL_SLO_MAX_PROJECTION_ERROR_RATIO'],
      DEFAULT_SLO_POLICY.maxProjectionErrorRatio,
    ),
    maxCanonicalFallbackRatio: parseRatio(
      'KOTOWARI_RETRIEVAL_SLO_MAX_CANONICAL_FALLBACK_RATIO',
      env['KOTOWARI_RETRIEVAL_SLO_MAX_CANONICAL_FALLBACK_RATIO'],
      DEFAULT_SLO_POLICY.maxCanonicalFallbackRatio,
    ),
    maxShadowMismatchRatio: parseRatio(
      'KOTOWARI_RETRIEVAL_SLO_MAX_SHADOW_MISMATCH_RATIO',
      env['KOTOWARI_RETRIEVAL_SLO_MAX_SHADOW_MISMATCH_RATIO'],
      DEFAULT_SLO_POLICY.maxShadowMismatchRatio,
    ),
  };
}

export function assessRetrievalRollout(
  snapshot: ProjectionServingSnapshot,
  policy: RetrievalRolloutSloPolicy = DEFAULT_SLO_POLICY,
): RetrievalRolloutSloAssessment {
  const projectionSamples = snapshot.projectionSearches + snapshot.projectionErrors;
  const userSearches = snapshot.canonicalSearches + snapshot.projectionServedSearches;
  const projectionErrorRatio = ratio(snapshot.projectionErrors, projectionSamples);
  const canonicalFallbackRatio = ratio(snapshot.canonicalFallbacks, userSearches);
  const shadowMismatchRatio = ratio(snapshot.shadowMismatches, snapshot.shadowComparisons);

  const assessment = (
    verdict: RetrievalRolloutSloVerdict,
    recommendedMode: RetrievalRolloutMode,
    reasons: readonly string[],
  ): RetrievalRolloutSloAssessment => ({
    verdict,
    recommendedMode,
    projectionSamples,
    userSearches,
    projectionErrorRatio,
    canonicalFallbackRatio,
    shadowMismatchRatio,
    reasons,
    policy,
  });

  if (snapshot.rollbackActive) {
    return assessment('rollback', 'disabled', ['automatic-circuit-breaker-active']);
  }

  const mode = snapshot.effectiveMode;
  if (mode === 'disabled') {
    return assessment('hold', 'disabled', ['rollout-disabled']);
  }

  if (!snapshot.ready) {
    return mode === 'shadow'
      ? assessment('hold', 'shadow', ['projection-unready'])
      : assessment('rollback', 'disabled', ['projection-unready']);
  }

  if (projectionSamples < policy.minProjectionSamples) {
    return assessment('insufficient-data', mode, [
      `projection-samples-below-${String(policy.minProjectionSamples)}`,
    ]);
  }

  const breaches: string[] = [];
  if (projectionErrorRatio > policy.maxProjectionErrorRatio) {
    breaches.push('projection-error-ratio');
  }
  if (
    (mode === 'canary' || mode === 'enabled') &&
    canonicalFallbackRatio > policy.maxCanonicalFallbackRatio
  ) {
    breaches.push('canonical-fallback-ratio');
  }
  if (mode === 'shadow' && shadowMismatchRatio > policy.maxShadowMismatchRatio) {
    breaches.push('shadow-mismatch-ratio');
  }

  if (breaches.length > 0) {
    return mode === 'shadow'
      ? assessment('hold', 'shadow', breaches)
      : assessment('rollback', 'disabled', breaches);
  }

  if (mode === 'shadow') {
    return assessment('promote', 'canary', ['shadow-guardrails-satisfied']);
  }
  if (mode === 'canary') {
    return assessment('promote', 'enabled', ['canary-guardrails-satisfied']);
  }
  return assessment('hold', 'enabled', ['enabled-guardrails-satisfied']);
}

export function retrievalRolloutSloMetrics(assessment: RetrievalRolloutSloAssessment): string {
  return [
    '# HELP kotowari_retrieval_rollout_slo_projection_samples Projection attempts observed by the local rollout evaluator.',
    '# TYPE kotowari_retrieval_rollout_slo_projection_samples gauge',
    `kotowari_retrieval_rollout_slo_projection_samples ${String(assessment.projectionSamples)}`,
    '# HELP kotowari_retrieval_rollout_slo_projection_error_ratio Projection errors divided by projection attempts.',
    '# TYPE kotowari_retrieval_rollout_slo_projection_error_ratio gauge',
    `kotowari_retrieval_rollout_slo_projection_error_ratio ${String(assessment.projectionErrorRatio)}`,
    '# HELP kotowari_retrieval_rollout_slo_canonical_fallback_ratio Canonical fallbacks divided by user searches.',
    '# TYPE kotowari_retrieval_rollout_slo_canonical_fallback_ratio gauge',
    `kotowari_retrieval_rollout_slo_canonical_fallback_ratio ${String(assessment.canonicalFallbackRatio)}`,
    '# HELP kotowari_retrieval_rollout_slo_shadow_mismatch_ratio Ordered shadow mismatches divided by completed shadow comparisons.',
    '# TYPE kotowari_retrieval_rollout_slo_shadow_mismatch_ratio gauge',
    `kotowari_retrieval_rollout_slo_shadow_mismatch_ratio ${String(assessment.shadowMismatchRatio)}`,
    '# HELP kotowari_retrieval_rollout_slo_verdict Current local rollout SLO assessment verdict.',
    '# TYPE kotowari_retrieval_rollout_slo_verdict gauge',
    `kotowari_retrieval_rollout_slo_verdict{verdict="${assessment.verdict}"} 1`,
    '# HELP kotowari_retrieval_rollout_slo_recommended_mode Recommended next rollout mode.',
    '# TYPE kotowari_retrieval_rollout_slo_recommended_mode gauge',
    `kotowari_retrieval_rollout_slo_recommended_mode{mode="${assessment.recommendedMode}"} 1`,
    '',
  ].join('\n');
}
