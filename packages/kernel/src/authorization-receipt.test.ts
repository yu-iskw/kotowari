import { describe, expect, it } from 'vitest';

import { allowWithReceipt, localStandaloneMetadata, localStandalonePrincipal } from './public.js';

describe('authorization receipts', () => {
  it('captures the observable authorization decision without hidden reasoning', () => {
    const principal = localStandalonePrincipal();
    const { decision, receipt } = allowWithReceipt(
      principal,
      'knowledge.read',
      { kind: 'claim', id: 'claim-1', metadata: localStandaloneMetadata(principal.id) },
      { tenantId: principal.tenantId, purpose: 'audit' },
    );

    expect(decision.effect).toBe('allow');
    expect(receipt).toMatchObject({
      principalId: principal.id,
      action: 'knowledge.read',
      resourceKind: 'claim',
      resourceId: 'claim-1',
      effect: 'allow',
      reason: 'ALLOW',
      purpose: 'audit',
    });
    expect(receipt.evaluatedAt).toBeTruthy();
  });
});
