import { asIsoTimestamp, validityOverlaps } from './public.js';
import { describe, expect, it } from 'vitest';

describe('validityOverlaps', () => {
  it('treats adjacent validity intervals as non-overlapping', () => {
    const left = {
      validFrom: asIsoTimestamp('2026-01-01T00:00:00.000Z'),
      validTo: asIsoTimestamp('2026-02-01T00:00:00.000Z'),
      recordedAt: asIsoTimestamp('2026-01-01T00:00:00.000Z'),
      assertedAt: asIsoTimestamp('2026-01-01T00:00:00.000Z'),
    };
    const right = {
      validFrom: asIsoTimestamp('2026-02-01T00:00:00.000Z'),
      validTo: asIsoTimestamp('2026-03-01T00:00:00.000Z'),
      recordedAt: asIsoTimestamp('2026-02-01T00:00:00.000Z'),
      assertedAt: asIsoTimestamp('2026-02-01T00:00:00.000Z'),
    };

    expect(validityOverlaps(left, right)).toBe(false);
  });
});
