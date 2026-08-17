import { describe, expect, it } from 'vitest';

import {
  asIsoTimestamp,
  asPrincipalId,
  buildClaimAsserted,
  buildContextSnapshot,
  buildDecisionRecorded,
  buildEntity,
  buildEvidenceInserted,
  localStandaloneMetadata,
} from '../contracts.js';
import type { CanonicalStore } from '../ports.js';

function provenance() {
  return {
    source: 'compliance-test',
    actor: asPrincipalId('local-user'),
    process: 'canonical-store-compliance',
    timestamp: asIsoTimestamp('2024-03-12T00:00:00.000Z'),
    parentIds: [] as const,
  };
}

export function canonicalStoreComplianceTests(
  factory: () => CanonicalStore | Promise<CanonicalStore>,
): void {
  describe('CanonicalStore compliance', () => {
    it('writes claim, evidence, event, and outbox in one withTransaction', async () => {
      const store = await factory();
      const metadata = localStandaloneMetadata();
      const entity = buildEntity({ metadata, labels: ['Acme'], provenance: provenance() });
      const { evidence, event: evidenceEvent } = buildEvidenceInserted({
        metadata,
        uri: 'file://doc.txt',
        contentHash: 'sha256:abc',
        mimeType: 'text/plain',
        provenance: provenance(),
      });
      const { claim, event: claimEvent } = buildClaimAsserted({
        metadata,
        subject: entity.id,
        predicate: 'is_named',
        object: { kind: 'literal', value: 'Acme' },
        validFrom: asIsoTimestamp('2024-01-01T00:00:00.000Z'),
        assertedAt: asIsoTimestamp('2024-03-12T00:00:00.000Z'),
        confidence: 0.95,
        evidenceIds: [evidence.id],
        provenance: provenance(),
      });

      await store.withTransaction(async (tx) => {
        await tx.putEntity(entity);
        await tx.putEvidence(evidence);
        await tx.assertClaim(claim);
        await tx.appendEvent(evidenceEvent);
        await tx.appendEvent(claimEvent);
        await tx.appendOutbox(claimEvent);
      });

      const loadedClaim = await store.getClaim(claim.id);
      const loadedEvidence = await store.getEvidence(evidence.id);
      const events = await store.listEvents();
      const outbox = await store.listOutbox();

      expect(loadedClaim?.id).toBe(claim.id);
      expect(loadedEvidence?.id).toBe(evidence.id);
      expect(events.some((event) => event.eventId === claimEvent.eventId)).toBe(true);
      expect(outbox.some((event) => event.eventId === claimEvent.eventId)).toBe(true);
    });

    it('persists valid kernel records without rejecting at the store layer', async () => {
      const store = await factory();
      const metadata = localStandaloneMetadata();
      const entity = buildEntity({ metadata, labels: ['Valid'], provenance: provenance() });
      const { evidence } = buildEvidenceInserted({
        metadata,
        uri: 'file://valid.txt',
        contentHash: 'sha256:valid',
        mimeType: 'text/plain',
        provenance: provenance(),
      });
      const { claim } = buildClaimAsserted({
        metadata,
        subject: entity.id,
        predicate: 'status',
        object: { kind: 'literal', value: 'ok' },
        validFrom: asIsoTimestamp('2024-01-01T00:00:00.000Z'),
        assertedAt: asIsoTimestamp('2024-03-12T00:00:00.000Z'),
        confidence: 1,
        evidenceIds: [evidence.id],
        provenance: provenance(),
      });

      await store.putEntity(entity);
      await store.putEvidence(evidence);
      await store.assertClaim(claim);

      expect(await store.getEntity(entity.id)).toEqual(entity);
      expect(await store.getEvidence(evidence.id)).toEqual(evidence);
      expect(await store.getClaim(claim.id)).toEqual(claim);
    });

    it('round-trips entity, evidence, claim, decision with context snapshot', async () => {
      const store = await factory();
      const metadata = localStandaloneMetadata();
      const entity = buildEntity({ metadata, labels: ['Roundtrip'], provenance: provenance() });
      const { evidence } = buildEvidenceInserted({
        metadata,
        uri: 'file://roundtrip.txt',
        contentHash: 'sha256:round',
        mimeType: 'text/plain',
        provenance: provenance(),
      });
      const { claim } = buildClaimAsserted({
        metadata,
        subject: entity.id,
        predicate: 'has_label',
        object: { kind: 'literal', value: 'Roundtrip' },
        validFrom: asIsoTimestamp('2024-01-01T00:00:00.000Z'),
        assertedAt: asIsoTimestamp('2024-03-12T00:00:00.000Z'),
        confidence: 0.9,
        evidenceIds: [evidence.id],
        provenance: provenance(),
      });
      const snapshot = buildContextSnapshot({
        metadata,
        purpose: 'decision',
        claimIds: [claim.id],
        evidenceIds: [evidence.id],
        policyVersionIds: [],
        items: [{ claimId: claim.id, evidenceIds: [evidence.id] }],
        budget: 10,
      });
      const { decision } = buildDecisionRecorded({
        metadata,
        inputContextSnapshot: snapshot,
        consideredEvidenceIds: [evidence.id],
        applicablePolicyIds: [],
        selectedOutcome: 'approve',
        alternatives: ['deny'],
        confidence: 0.85,
        actor: asPrincipalId('local-user'),
        resultingActionIds: [],
        policyEvaluations: [],
        provenance: provenance(),
      });

      await store.putEntity(entity);
      await store.putEvidence(evidence);
      await store.assertClaim(claim);
      await store.putContextSnapshot(snapshot);
      await store.putDecision(decision);

      expect(await store.getEntity(entity.id)).toEqual(entity);
      expect(await store.getEvidence(evidence.id)).toEqual(evidence);
      expect(await store.getClaim(claim.id)).toEqual(claim);
      expect(await store.getContextSnapshot(snapshot.id)).toEqual(snapshot);
      expect(await store.getDecision(decision.id)).toEqual(decision);
    });

    it('ADR-0002: clearing embeddings then re-put does not change claim ids', async () => {
      const store = await factory();
      const metadata = localStandaloneMetadata();
      const entity = buildEntity({ metadata, labels: ['Embed'], provenance: provenance() });
      const { evidence } = buildEvidenceInserted({
        metadata,
        uri: 'file://embed.txt',
        contentHash: 'sha256:embed',
        mimeType: 'text/plain',
        provenance: provenance(),
      });
      const { claim } = buildClaimAsserted({
        metadata,
        subject: entity.id,
        predicate: 'topic',
        object: { kind: 'literal', value: 'embeddings' },
        validFrom: asIsoTimestamp('2024-01-01T00:00:00.000Z'),
        assertedAt: asIsoTimestamp('2024-03-12T00:00:00.000Z'),
        confidence: 0.8,
        evidenceIds: [evidence.id],
        provenance: provenance(),
      });

      await store.putEntity(entity);
      await store.putEvidence(evidence);
      await store.assertClaim(claim);
      await store.putEmbedding({ claimId: claim.id, vector: [0.1, 0.2, 0.3] });

      const claimIdBefore = (await store.getClaim(claim.id))?.id;
      expect(claimIdBefore).toBe(claim.id);

      await store.clearEmbeddings();
      expect(await store.listEmbeddings()).toEqual([]);

      await store.putEmbedding({ claimId: claim.id, vector: [0.4, 0.5, 0.6] });
      const claimIdAfter = (await store.getClaim(claim.id))?.id;
      expect(claimIdAfter).toBe(claim.id);
      expect(await store.listEmbeddings()).toEqual([{ claimId: claim.id, vector: [0.4, 0.5, 0.6] }]);
    });
  });
}
