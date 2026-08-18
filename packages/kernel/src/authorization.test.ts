import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ACTIONS } from './authorization.js';
import {
  allow,
  asIsoTimestamp,
  asNamespaceId,
  asPrincipalId,
  asTenantId,
  classificationRank,
  localStandalonePrincipal,
} from './public.js';
import { CLASSIFICATIONS } from './scoped-metadata.js';

import type { Action, AuthContext, Principal, Resource } from './public.js';

const tenantA = asTenantId('tenant-a');
const tenantB = asTenantId('tenant-b');
const nsA = asNamespaceId('ns-a');

function human(overrides?: Partial<Extract<Principal, { kind: 'human' }>>): Principal {
  return {
    kind: 'human',
    id: asPrincipalId('user-a'),
    tenantId: tenantA,
    clearance: 'internal',
    namespaceIds: [nsA],
    roles: ['member'],
    ...overrides,
  };
}

function resource(overrides?: Partial<Resource['metadata']>): Resource {
  return {
    kind: 'claim',
    id: 'c1',
    metadata: {
      tenantId: tenantA,
      namespaceId: nsA,
      classification: 'internal',
      visibility: 'workspace',
      policyTags: [],
      ...overrides,
    },
  };
}

describe('ADR-0010 allow()', () => {
  it('denies cross-tenant reads', () => {
    const decision = allow(human(), 'knowledge.read', resource({ tenantId: tenantB }), {
      tenantId: tenantA,
    });
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toBe('CROSS_TENANT_DENIED');
  });

  it('omits classified evidence when clearance is too low (S10)', () => {
    const decision = allow(
      human({ clearance: 'public' }),
      'knowledge.read',
      resource({ classification: 'tlp:red' }),
      {
        tenantId: tenantA,
      },
    );
    expect(decision.effect).toBe('deny');
    expect(decision.reason).toBe('CLASSIFICATION_DENIED');
  });

  it('standalone local principal is a real ACL subject, not ACL-off', () => {
    const local = localStandalonePrincipal();
    const allowed = allow(
      local,
      'knowledge.read',
      {
        kind: 'claim',
        id: 'c1',
        metadata: {
          tenantId: local.tenantId,
          namespaceId: local.namespaceIds[0]!,
          classification: 'internal',
          visibility: 'workspace',
          policyTags: [],
        },
      },
      { tenantId: local.tenantId },
    );
    expect(allowed.effect).toBe('allow');
    const otherTenant = allow(
      local,
      'knowledge.read',
      {
        kind: 'claim',
        id: 'c2',
        metadata: {
          tenantId: tenantB,
          namespaceId: nsA,
          classification: 'public',
          visibility: 'workspace',
          policyTags: [],
        },
      },
      { tenantId: local.tenantId },
    );
    expect(otherTenant.effect).toBe('deny');
  });

  it('agent acting-for requires unexpired delegation covering the action', () => {
    const agent: Principal = {
      kind: 'agent',
      id: asPrincipalId('agent-1'),
      tenantId: tenantA,
      clearance: 'internal',
      namespaceIds: [nsA],
      roles: ['member'],
      actingFor: asPrincipalId('user-a'),
    };
    const ctx: AuthContext = {
      tenantId: tenantA,
      now: asIsoTimestamp('2024-06-01T00:00:00.000Z'),
    };
    expect(allow(agent, 'knowledge.read', resource(), ctx).reason).toBe('DELEGATION_DENIED');
    const withDelegation: AuthContext = {
      ...ctx,
      delegation: {
        delegatorId: asPrincipalId('user-a'),
        scope: ['knowledge.read'],
        expiresAt: asIsoTimestamp('2024-12-01T00:00:00.000Z'),
      },
    };
    expect(allow(agent, 'knowledge.read', resource(), withDelegation).effect).toBe('allow');
    expect(allow(agent, 'knowledge.write', resource(), withDelegation).reason).toBe(
      'DELEGATION_DENIED',
    );
  });

  it('ADR-0010 property: cross-tenant never allows', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ACTIONS),
        fc.constantFrom(...CLASSIFICATIONS),
        (action: Action, classification) => {
          const decision = allow(human(), action, resource({ tenantId: tenantB, classification }), {
            tenantId: tenantA,
          });
          expect(decision.effect).toBe('deny');
          expect(decision.reason).toBe('CROSS_TENANT_DENIED');
        },
      ),
    );
  });

  it('ADR-0010 property: insufficient clearance never allows', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ACTIONS), (action: Action) => {
        const decision = allow(
          human({ clearance: 'public' }),
          action,
          resource({ classification: 'tlp:red' }),
          {
            tenantId: tenantA,
          },
        );
        expect(decision.effect).toBe('deny');
        expect(decision.reason).toBe('CLASSIFICATION_DENIED');
        expect(classificationRank('public')).toBeLessThan(classificationRank('tlp:red'));
      }),
    );
  });
});
