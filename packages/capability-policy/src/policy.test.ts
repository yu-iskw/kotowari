import { localStandalonePrincipal } from '@kotowari/kernel';
import { createMemoryCanonicalStore } from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { isPolicyApplicable, putPolicyVersion } from './policy.js';

describe('policy versions', () => {
  it('keeps a stable logical policy id across immutable versions and respects applicability', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const first = await putPolicyVersion({
      store,
      principal,
      name: 'release-policy',
      version: 1,
      rules: { allowedOutcomes: ['approve'] },
      status: 'active',
      applicability: { purposes: ['release'] },
    });
    const second = await putPolicyVersion({
      store,
      principal,
      policyId: first.policyId,
      name: 'release-policy',
      version: 2,
      rules: { minConfidence: 0.8 },
      status: 'active',
      applicability: { purposes: ['release'] },
    });

    expect(second.policyId).toBe(first.policyId);
    expect(second.id).not.toBe(first.id);
    expect(isPolicyApplicable(second, { purpose: 'release' })).toBe(true);
    expect(isPolicyApplicable(second, { purpose: 'underwriting' })).toBe(false);
  });
});
