export type RetrievalRolloutMode = 'disabled' | 'shadow' | 'canary' | 'enabled';

export type RetrievalRolloutPolicy = {
  mode: RetrievalRolloutMode;
  canaryPercent: number;
  maxConsecutiveErrors: number;
};

const MODES = new Set<RetrievalRolloutMode>(['disabled', 'shadow', 'canary', 'enabled']);

function parsePercent(value: string | undefined, fallback: number): number {
  if (value === undefined || value.length === 0) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    throw new Error('KOTOWARI_RETRIEVAL_CANARY_PERCENT must be between 0 and 100');
  }
  return parsed;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.length === 0) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('KOTOWARI_RETRIEVAL_MAX_CONSECUTIVE_ERRORS must be a positive integer');
  }
  return parsed;
}

export function retrievalRolloutPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
): RetrievalRolloutPolicy {
  const rawMode = env['KOTOWARI_RETRIEVAL_ROLLOUT_MODE'] ?? 'enabled';
  if (!MODES.has(rawMode as RetrievalRolloutMode)) {
    throw new Error(
      'KOTOWARI_RETRIEVAL_ROLLOUT_MODE must be disabled, shadow, canary, or enabled',
    );
  }
  return {
    mode: rawMode as RetrievalRolloutMode,
    canaryPercent: parsePercent(env['KOTOWARI_RETRIEVAL_CANARY_PERCENT'], 10),
    maxConsecutiveErrors: parsePositiveInt(
      env['KOTOWARI_RETRIEVAL_MAX_CONSECUTIVE_ERRORS'],
      3,
    ),
  };
}

export function stableCanarySample(key: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 42_949_672.96;
}
