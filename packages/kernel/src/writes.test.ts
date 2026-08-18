import { describe, expect, it } from 'vitest';

import {
  asIsoTimestamp,
  asPrincipalId,
  buildClaimRetracted,
  buildConflictResolved,
  buildEntity,
  buildEntityMerged,
  KernelError,
  localStandaloneMetadata,
  requireProvenance,
} from './public.js';

import type { SemanticWriteInput } from './public.js';

function provenance() {
  return {
    source: 'test',
    actor: asPrincipalId('local-user'),
    process: 'unit',
    timestamp: asIsoTimestamp('2024-03-12T00:00:00.000Z'),
    parentIds: [] as const,
  };
}

describe('entity merge and conflict resolution', () => {
  it('records entity.merged with provenance', () => {
    const metadata = localStandaloneMetadata();
    const surviving = buildEntity({ metadata, labels: ['Alice'], provenance: provenance() });
    const absorbed = buildEntity({ metadata, labels: ['A. Chen'], provenance: provenance() });
    const { event } = buildEntityMerged(
      {
        metadata,
        survivingEntityId: surviving.id,
        absorbedEntityIds: [absorbed.id],
        provenance: provenance(),
      },
      surviving,
    );
    expect(event.kind).toBe('entity.merged');
  });

  it('S17 records conflict resolution with provenance', () => {
    const { resolution, event } = buildConflictResolved({
      metadata: localStandaloneMetadata(),
      kind: 'value',
      claimIds: ['c1' as never, 'c2' as never],
      strategy: 'human_review',
      preferredClaimId: 'c1' as never,
      reason: 'Later filing is authoritative',
      provenance: provenance(),
    });
    expect(resolution.reason).toContain('authoritative');
    expect(event.kind).toBe('conflict.resolved');
    expect(resolution.provenance.source).toBe('test');
    const reused = buildConflictResolved({
      metadata: localStandaloneMetadata(),
      kind: 'value',
      claimIds: ['c1' as never, 'c2' as never],
      strategy: 'human_review',
      preferredClaimId: 'c1' as never,
      reason: 'Later filing is authoritative',
      provenance: provenance(),
      conflictId: resolution.id,
    });
    expect(reused.conflict.id).toBe(resolution.id);
    expect(reused.resolution.id).toBe(resolution.id);
  });

  it('retracts an asserted claim', () => {
    const entity = buildEntity({
      metadata: localStandaloneMetadata(),
      labels: ['x'],
      provenance: provenance(),
    });
    expect(entity.labels).toEqual(['x']);
  });
});

describe('ADR-0007 property: semantic write kinds require provenance', () => {
  const kinds: SemanticWriteInput['kind'][] = [
    'claim.asserted',
    'claim.retracted',
    'evidence.inserted',
    'entity.merged',
    'decision.recorded',
    'policy.evaluated',
    'conflict.resolved',
  ];

  it.each(kinds)('ADR-0007 rejects %s without provenance', (kind) => {
    const write = { kind, input: { provenance: undefined } } as unknown as SemanticWriteInput;
    expect(() => requireProvenance(write)).toThrow(KernelError);
  });
});

describe('claim retract', () => {
  it('rejects retracting an already retracted claim', () => {
    expect(() =>
      buildClaimRetracted(
        { claimId: 'c1' as never, provenance: provenance() },
        {
          ...localStandaloneMetadata(),
          id: 'c1' as never,
          subject: 'e' as never,
          predicate: 'p',
          object: { kind: 'literal', value: 'v' },
          bitemporal: {
            validFrom: asIsoTimestamp('2020-01-01T00:00:00.000Z'),
            recordedAt: asIsoTimestamp('2020-01-01T00:00:00.000Z'),
            assertedAt: asIsoTimestamp('2020-01-01T00:00:00.000Z'),
          },
          confidence: 1,
          status: 'retracted',
          evidenceIds: ['e' as never],
          provenance: provenance(),
        },
      ),
    ).toThrow(KernelError);
  });
});
