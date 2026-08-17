import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { localStandaloneMetadata } from './authorization.js';
import { asPrincipalId } from './branded-ids.js';
import { asIsoTimestamp, claimText, claimValidAt, detectClaimOverlap } from './public.js';

import type { Claim } from './public.js';

function claim(overrides: Partial<Claim> & Pick<Claim, 'id' | 'object' | 'bitemporal'>): Claim {
  return {
    ...localStandaloneMetadata(),
    subject: 'e1' as Claim['subject'],
    predicate: 'is_ceo_of',
    confidence: 0.8,
    status: 'asserted',
    evidenceIds: ['ev' as Claim['evidenceIds'][number]],
    provenance: {
      source: 't',
      actor: asPrincipalId('local-user'),
      process: 't',
      timestamp: asIsoTimestamp('2024-01-01T00:00:00.000Z'),
      parentIds: [],
    },
    ...overrides,
  };
}

describe('claim text and validity', () => {
  it('renders literal and entity objects', () => {
    expect(claimText({ predicate: 'is_ceo_of', object: { kind: 'literal', value: 'Vendor X' } })).toBe(
      'is_ceo_of Vendor X',
    );
    expect(claimText({ predicate: 'works_at', object: { kind: 'entity', entityId: 'e1' as Claim['subject'] } })).toBe(
      'works_at e1',
    );
  });

  it('treats missing asOf as always valid and excludes validTo', () => {
    const sample = claim({
      id: 'c1' as Claim['id'],
      object: { kind: 'literal', value: 'Vendor X' },
      bitemporal: {
        validFrom: asIsoTimestamp('2024-01-01T00:00:00.000Z'),
        validTo: asIsoTimestamp('2025-01-01T00:00:00.000Z'),
        recordedAt: asIsoTimestamp('2024-03-01T00:00:00.000Z'),
        assertedAt: asIsoTimestamp('2024-03-01T00:00:00.000Z'),
      },
    });
    expect(claimValidAt(sample, undefined)).toBe(true);
    expect(claimValidAt(sample, '2024-06-01T00:00:00.000Z')).toBe(true);
    expect(claimValidAt(sample, '2025-01-01T00:00:00.000Z')).toBe(false);
  });
});

describe('bitemporal claim overlap', () => {
  it('detects competing truths with overlapping validity', () => {
    const a = claim({
      id: 'c1' as Claim['id'],
      object: { kind: 'literal', value: 'Vendor X' },
      bitemporal: {
        validFrom: asIsoTimestamp('2024-01-01T00:00:00.000Z'),
        validTo: asIsoTimestamp('2025-12-31T00:00:00.000Z'),
        recordedAt: asIsoTimestamp('2024-03-01T00:00:00.000Z'),
        assertedAt: asIsoTimestamp('2024-03-01T00:00:00.000Z'),
      },
    });
    const b = claim({
      id: 'c2' as Claim['id'],
      object: { kind: 'literal', value: 'not CEO' },
      bitemporal: {
        validFrom: asIsoTimestamp('2025-01-01T00:00:00.000Z'),
        recordedAt: asIsoTimestamp('2025-06-01T00:00:00.000Z'),
        assertedAt: asIsoTimestamp('2025-06-01T00:00:00.000Z'),
      },
    });
    expect(detectClaimOverlap(a, b)).toBe(true);
  });

  it('does not conflict when validity windows are disjoint', () => {
    const a = claim({
      id: 'c1' as Claim['id'],
      object: { kind: 'literal', value: 'Vendor X' },
      bitemporal: {
        validFrom: asIsoTimestamp('2020-01-01T00:00:00.000Z'),
        validTo: asIsoTimestamp('2023-12-31T00:00:00.000Z'),
        recordedAt: asIsoTimestamp('2020-01-01T00:00:00.000Z'),
        assertedAt: asIsoTimestamp('2020-01-01T00:00:00.000Z'),
      },
    });
    const b = claim({
      id: 'c2' as Claim['id'],
      object: { kind: 'literal', value: 'other' },
      bitemporal: {
        validFrom: asIsoTimestamp('2024-01-01T00:00:00.000Z'),
        recordedAt: asIsoTimestamp('2024-01-01T00:00:00.000Z'),
        assertedAt: asIsoTimestamp('2024-01-01T00:00:00.000Z'),
      },
    });
    expect(detectClaimOverlap(a, b)).toBe(false);
  });

  it('property: identical objects never conflict', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (value) => {
        const a = claim({
          id: 'c1' as Claim['id'],
          object: { kind: 'literal', value },
          bitemporal: {
            validFrom: asIsoTimestamp('2020-01-01T00:00:00.000Z'),
            recordedAt: asIsoTimestamp('2020-01-01T00:00:00.000Z'),
            assertedAt: asIsoTimestamp('2020-01-01T00:00:00.000Z'),
          },
        });
        const b = claim({
          id: 'c2' as Claim['id'],
          object: { kind: 'literal', value },
          bitemporal: {
            validFrom: asIsoTimestamp('2020-06-01T00:00:00.000Z'),
            recordedAt: asIsoTimestamp('2020-06-01T00:00:00.000Z'),
            assertedAt: asIsoTimestamp('2020-06-01T00:00:00.000Z'),
          },
        });
        expect(detectClaimOverlap(a, b)).toBe(false);
      }),
    );
  });
});
