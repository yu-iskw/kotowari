import { localStandalonePrincipal } from '@kotowari/kernel';
import { createMemoryCanonicalStore } from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { isPolicyApplicable, putPolicyVersion } from './policy.js';

describe('policy versions', () => {
  it('keeps stable logical identity, unique version identity, and respects applicability', async () => {
    const store = createMemoryCanonicalStore();
    const principal = localStandalonePrincipal();
    const first = await putPolicyVersion({
      store,
      principal,
      name: 'release-policy',
      version: 1,
      rules: { allowedOutcomes: ['approve'] },
      status: 'active',
      applicability: { purposes: ['release'], classifications: ['internal'] },
    });
    const second = await putPolicyVersion({
      store,
      principal,
      policyId: first.policyId,
      name: 'release-policy',
      version: 2,
      rules: { minConfidence: 0.8 },
      status: 'active',
      applicability: { purposes: ['release'], classifications: ['internal'] },
    });

    expect(second.policyId).toBe(first.policyId);
    expect(second.versionId).not.toBe(first.versionId);
    expect(second.id).toBe(second.versionId);
    expect(isPolicyApplicable(second, { purpose: 'release', classification: 'internal' })).toBe(
      true,
    );
    expect(
      isPolicyApplicable(second, { purpose: 'release', classification: 'confidential' }),
    ).toBe(false);
    expect(isPolicyApplicable(second, { purpose: 'underwriting', classification: 'internal' })).toBe(
      false,
    );
  });
});
