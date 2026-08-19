import { describe, expect, it } from 'vitest';

import { retrievalRolloutPolicyFromEnv, stableCanarySample } from './retrieval-rollout.js';

describe('retrieval rollout policy', () => {
  it('preserves enabled serving by default', () => {
    expect(retrievalRolloutPolicyFromEnv({})).toEqual({
      mode: 'enabled',
      canaryPercent: 10,
      maxConsecutiveErrors: 3,
    });
  });

  it('reads staged rollout controls from the environment', () => {
    expect(
      retrievalRolloutPolicyFromEnv({
        KOTOWARI_RETRIEVAL_ROLLOUT_MODE: 'canary',
        KOTOWARI_RETRIEVAL_CANARY_PERCENT: '12.5',
        KOTOWARI_RETRIEVAL_MAX_CONSECUTIVE_ERRORS: '5',
      }),
    ).toEqual({
      mode: 'canary',
      canaryPercent: 12.5,
      maxConsecutiveErrors: 5,
    });
  });

  it('rejects invalid rollout configuration instead of silently guessing', () => {
    expect(() =>
      retrievalRolloutPolicyFromEnv({ KOTOWARI_RETRIEVAL_ROLLOUT_MODE: 'partial' }),
    ).toThrow(/ROLLOUT_MODE/);
    expect(() =>
      retrievalRolloutPolicyFromEnv({ KOTOWARI_RETRIEVAL_CANARY_PERCENT: '101' }),
    ).toThrow(/CANARY_PERCENT/);
    expect(() =>
      retrievalRolloutPolicyFromEnv({ KOTOWARI_RETRIEVAL_MAX_CONSECUTIVE_ERRORS: '0' }),
    ).toThrow(/MAX_CONSECUTIVE_ERRORS/);
  });

  it('produces a stable canary sample in the expected percentage range', () => {
    const first = stableCanarySample('tenant|namespace|vector|query');
    expect(first).toBe(stableCanarySample('tenant|namespace|vector|query'));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(100);
  });
});
