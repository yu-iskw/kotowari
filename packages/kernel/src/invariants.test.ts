import { describe, expect, it } from 'vitest';

import { buildContextSnapshot } from './invariants.js';
import {
  asIsoTimestamp,
  asPrincipalId,
  assertNoChainOfThought,
  buildClaimAsserted,
  buildDecisionRecorded,
  buildEvidenceInserted,
  KernelError,
  localStandaloneMetadata,
  requireProvenance,
} from './public.js';

import type { AssertClaimInput, RecordDecisionInput, SemanticWriteInput } from './public.js';

function provenance() {
  return {
    source: 'test',
    actor: asPrincipalId('local-user'),
    process: 'unit',
    timestamp: asIsoTimestamp('2024-03-12T00:00:00.000Z'),
    parentIds: [] as const,
  };
}

function claimInput(overrides?: Partial<AssertClaimInput>): AssertClaimInput {
  return {
    metadata: localStandaloneMetadata(),
    subject: 'e-alice' as AssertClaimInput['subject'],
    predicate: 'is_ceo_of',
    object: { kind: 'literal', value: 'Vendor X' },
    validFrom: asIsoTimestamp('2024-01-01T00:00:00.000Z'),
    assertedAt: asIsoTimestamp('2024-03-12T00:00:00.000Z'),
    confidence: 0.9,
    evidenceIds: ['ev-1' as AssertClaimInput['evidenceIds'][number]],
    provenance: provenance(),
    ...overrides,
  };
}

describe('ADR-0007 provenance', () => {
  it('ADR-0007 rejects claim write without provenance', () => {
    const write = {
      kind: 'claim.asserted',
      input: { ...claimInput(), provenance: undefined },
    } as unknown as SemanticWriteInput;
    expect(() => requireProvenance(write)).toThrow(KernelError);
    try {
      requireProvenance(write);
    } catch (error) {
      expect(error).toBeInstanceOf(KernelError);
      expect((error as KernelError).code).toBe('PROVENANCE_REQUIRED');
    }
  });

  it('ADR-0007 persists compact provenance fields on a happy-path claim', () => {
    const { claim, event } = buildClaimAsserted(claimInput());
    expect(claim.provenance.source).toBe('test');
    expect(claim.provenance.actor).toBe('local-user');
    expect(claim.provenance.process).toBe('unit');
    expect(claim.evidenceIds).toHaveLength(1);
    expect(event.kind).toBe('claim.asserted');
  });

  it('rejects a claim with no evidence', () => {
    expect(() => buildClaimAsserted(claimInput({ evidenceIds: [] }))).toThrow(/evidence/i);
  });
});

describe('ADR-0008 decisions', () => {
  it('ADR-0008 requires a context snapshot and evidence refs', () => {
    const snapshot = buildContextSnapshot({
      metadata: localStandaloneMetadata(),
      purpose: 'underwriting',
      claimIds: [],
      evidenceIds: ['ev-1' as never],
      policyVersionIds: ['pol-credit-001@2'],
      items: [],
      budget: 20,
    });
    const input: RecordDecisionInput = {
      metadata: localStandaloneMetadata(),
      inputContextSnapshot: snapshot,
      consideredEvidenceIds: ['ev-1' as never],
      applicablePolicyIds: ['pol-credit-001' as never],
      selectedOutcome: 'approve',
      alternatives: ['deny'],
      confidence: 0.8,
      actor: asPrincipalId('local-user'),
      resultingActionIds: [],
      policyEvaluations: [],
      provenance: provenance(),
    };
    const { decision } = buildDecisionRecorded(input);
    expect(decision.inputContextSnapshot.id).toBe(snapshot.id);
    expect(decision.consideredEvidenceIds).toEqual(['ev-1']);
  });

  it('ADR-0008 rejects chainOfThought on a decision payload', () => {
    expect(() => assertNoChainOfThought({ chainOfThought: 'secret' })).toThrow(KernelError);
    expect(() => assertNoChainOfThought({ hiddenCoT: 'nope' })).toThrow(/chain-of-thought/i);
  });
});

describe('evidence insert', () => {
  it('builds evidence with provenance', () => {
    const { evidence, event } = buildEvidenceInserted({
      metadata: localStandaloneMetadata(),
      uri: 'file://notes.md',
      contentHash: 'abc',
      mimeType: 'text/markdown',
      title: 'notes',
      provenance: provenance(),
    });
    expect(evidence.uri).toBe('file://notes.md');
    expect(event.kind).toBe('evidence.inserted');
  });
});
