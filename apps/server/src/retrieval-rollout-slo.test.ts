import { describe, expect, it } from 'vitest';

import {
  assessRetrievalRollout,
  retrievalRolloutSloMetrics,
  retrievalRolloutSloPolicyFromEnv,
} from './retrieval-rollout-slo.js';

import type { ProjectionServingSnapshot } from './projection-serving.js';

function snapshot(
  overrides: Partial<ProjectionServingSnapshot> = {},
): ProjectionServingSnapshot {
  return {
    projectionId: 'postgres-retrieval-v1',
    pendingEvents: 0,
    stale: false,
    ready: true,
    servingReady: true,
    healthy: true,
    checkedAt: '2026-08-19T00:00:00.000Z',
    desiredMode: 'shadow',
    effectiveMode: 'shadow',
    canaryPercent: 10,
    rollbackActive: false,
    consecutiveProjectionErrors: 0,
    projectionSearches: 100,
    projectionServedSearches: 0,
    canonicalSearches: 100,
    canonicalFallbacks: 0,
    projectionErrors: 0,
    shadowComparisons: 100,
    shadowMismatches: 0,
    ...overrides,
  };
}

describe('retrieval rollout SLO policy', () => {
  it('uses conservative default rollout guardrails', () => {
    expect(retrievalRolloutSloPolicyFromEnv({})).toEqual({
      minProjectionSamples: 100,
      maxProjectionErrorRatio: 0.01,
      maxCanonicalFallbackRatio: 0.02,
      maxShadowMismatchRatio: 0.1,
    });
  });

  it('reads rollout SLO thresholds from the environment', () => {
    expect(
      retrievalRolloutSloPolicyFromEnv({
        KOTOWARI_RETRIEVAL_SLO_MIN_PROJECTION_SAMPLES: '250',
        KOTOWARI_RETRIEVAL_SLO_MAX_PROJECTION_ERROR_RATIO: '0.005',
        KOTOWARI_RETRIEVAL_SLO_MAX_CANONICAL_FALLBACK_RATIO: '0.01',
        KOTOWARI_RETRIEVAL_SLO_MAX_SHADOW_MISMATCH_RATIO: '0.05',
      }),
    ).toEqual({
      minProjectionSamples: 250,
      maxProjectionErrorRatio: 0.005,
      maxCanonicalFallbackRatio: 0.01,
      maxShadowMismatchRatio: 0.05,
    });
  });

  it('rejects invalid thresholds', () => {
    expect(() =>
      retrievalRolloutSloPolicyFromEnv({
        KOTOWARI_RETRIEVAL_SLO_MIN_PROJECTION_SAMPLES: '0',
      }),
    ).toThrow(/MIN_PROJECTION_SAMPLES/);
    expect(() =>
      retrievalRolloutSloPolicyFromEnv({
        KOTOWARI_RETRIEVAL_SLO_MAX_PROJECTION_ERROR_RATIO: '1.1',
      }),
    ).toThrow(/MAX_PROJECTION_ERROR_RATIO/);
  });
});

describe('retrieval rollout SLO assessment', () => {
  it('promotes healthy shadow traffic to canary', () => {
    expect(assessRetrievalRollout(snapshot())).toMatchObject({
      verdict: 'promote',
      recommendedMode: 'canary',
      projectionErrorRatio: 0,
      canonicalFallbackRatio: 0,
      shadowMismatchRatio: 0,
    });
  });

  it('holds shadow rollout when semantic parity exceeds the mismatch guardrail', () => {
    const assessment = assessRetrievalRollout(snapshot({ shadowMismatches: 11 }));
    expect(assessment.verdict).toBe('hold');
    expect(assessment.recommendedMode).toBe('shadow');
    expect(assessment.reasons).toContain('shadow-mismatch-ratio');
  });

  it('waits for enough projection evidence before recommending promotion', () => {
    const assessment = assessRetrievalRollout(
      snapshot({
        projectionSearches: 20,
        canonicalSearches: 20,
        shadowComparisons: 20,
      }),
    );
    expect(assessment.verdict).toBe('insufficient-data');
    expect(assessment.recommendedMode).toBe('shadow');
  });

  it('rolls canary traffic back when error or fallback ratios breach guardrails', () => {
    const assessment = assessRetrievalRollout(
      snapshot({
        desiredMode: 'canary',
        effectiveMode: 'canary',
        projectionSearches: 95,
        projectionServedSearches: 95,
        projectionErrors: 5,
        canonicalSearches: 105,
        canonicalFallbacks: 5,
        shadowComparisons: 0,
        shadowMismatches: 0,
      }),
    );
    expect(assessment.verdict).toBe('rollback');
    expect(assessment.recommendedMode).toBe('disabled');
    expect(assessment.reasons).toContain('projection-error-ratio');
    expect(assessment.reasons).toContain('canonical-fallback-ratio');
  });

  it('treats an unready projection as a rollback condition for serving modes', () => {
    const assessment = assessRetrievalRollout(
      snapshot({
        desiredMode: 'enabled',
        effectiveMode: 'enabled',
        ready: false,
        servingReady: false,
      }),
    );
    expect(assessment.verdict).toBe('rollback');
    expect(assessment.reasons).toEqual(['projection-unready']);
  });

  it('surfaces the existing circuit breaker as the highest-priority rollback signal', () => {
    const assessment = assessRetrievalRollout(
      snapshot({
        rollbackActive: true,
        desiredMode: 'enabled',
        effectiveMode: 'disabled',
      }),
    );
    expect(assessment.verdict).toBe('rollback');
    expect(assessment.recommendedMode).toBe('disabled');
    expect(assessment.reasons).toEqual(['automatic-circuit-breaker-active']);
  });

  it('exports low-cardinality Prometheus signals for automation and alerting', () => {
    const metrics = retrievalRolloutSloMetrics(assessRetrievalRollout(snapshot()));
    expect(metrics).toContain('kotowari_retrieval_rollout_slo_projection_error_ratio 0');
    expect(metrics).toContain('kotowari_retrieval_rollout_slo_verdict{verdict="promote"} 1');
    expect(metrics).toContain(
      'kotowari_retrieval_rollout_slo_recommended_mode{mode="canary"} 1',
    );
  });
});
