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
  newId,
} from '../contracts.js';

import type { CanonicalStore } from '../ports.js';

const COMPLIANCE_INSTANT = '2024-03-12T00:00:00.000Z';
const COMPLIANCE_VALID_FROM = '2024-01-01T00:00:00.000Z';
const QUERY_VALID_AT = '2024-02-01T00:00:00.000Z';
const COMPLIANCE_MIME = 'text/plain';
const ACME_LABEL = 'Acme';

type StoreFactory = () => CanonicalStore | Promise<CanonicalStore>;

function provenance() {
  return {
    source: 'compliance-test',
    actor: asPrincipalId('local-user'),
    process: 'canonical-store-compliance',
    timestamp: asIsoTimestamp(COMPLIANCE_INSTANT),
    parentIds: [] as const,
  };
}

function registerCoreCompliance(factory: StoreFactory): void {
  it('writes claim, evidence, event, and outbox in one withTransaction', async () => {
    const store = await factory();
    const metadata = localStandaloneMetadata();
    const entity = buildEntity({ metadata, labels: [ACME_LABEL], provenance: provenance() });
    const { evidence, event: evidenceEvent } = buildEvidenceInserted({
      metadata,
      uri: 'file://doc.txt',
      contentHash: 'sha256:abc',
      mimeType: COMPLIANCE_MIME,
      provenance: provenance(),
    });
    const { claim, event: claimEvent } = buildClaimAsserted({
      metadata,
      subject: entity.id,
      predicate: 'is_named',
      object: { kind: 'literal', value: ACME_LABEL },
      validFrom: asIsoTimestamp(COMPLIANCE_VALID_FROM),
      assertedAt: asIsoTimestamp(COMPLIANCE_INSTANT),
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

    expect((await store.getClaim(claim.id))?.id).toBe(claim.id);
    expect((await store.getEvidence(evidence.id))?.id).toBe(evidence.id);
    expect((await store.listEvents()).some((event) => event.eventId === claimEvent.eventId)).toBe(
      true,
    );
    expect((await store.listOutbox()).some((event) => event.eventId === claimEvent.eventId)).toBe(
      true,
    );
  });

  it('persists valid kernel records without rejecting at the store layer', async () => {
    const store = await factory();
    const metadata = localStandaloneMetadata();
    const entity = buildEntity({ metadata, labels: ['Valid'], provenance: provenance() });
    const { evidence } = buildEvidenceInserted({
      metadata,
      uri: 'file://valid.txt',
      contentHash: 'sha256:valid',
      mimeType: COMPLIANCE_MIME,
      provenance: provenance(),
    });
    const { claim } = buildClaimAsserted({
      metadata,
      subject: entity.id,
      predicate: 'status',
      object: { kind: 'literal', value: 'ok' },
      validFrom: asIsoTimestamp(COMPLIANCE_VALID_FROM),
      assertedAt: asIsoTimestamp(COMPLIANCE_INSTANT),
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
      mimeType: COMPLIANCE_MIME,
      provenance: provenance(),
    });
    const { claim } = buildClaimAsserted({
      metadata,
      subject: entity.id,
      predicate: 'has_label',
      object: { kind: 'literal', value: 'Roundtrip' },
      validFrom: asIsoTimestamp(COMPLIANCE_VALID_FROM),
      assertedAt: asIsoTimestamp(COMPLIANCE_INSTANT),
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
}

function registerTemporalCompliance(factory: StoreFactory): void {
  it('preserves prior claim versions for knownAt queries after retraction', async () => {
    const store = await factory();
    const metadata = localStandaloneMetadata();
    const entity = buildEntity({ metadata, labels: ['Temporal'], provenance: provenance() });
    const { evidence } = buildEvidenceInserted({
      metadata,
      uri: 'file://temporal.txt',
      contentHash: 'sha256:temporal',
      mimeType: COMPLIANCE_MIME,
      provenance: provenance(),
    });
    const { claim } = buildClaimAsserted({
      metadata,
      subject: entity.id,
      predicate: 'status',
      object: { kind: 'literal', value: 'active' },
      validFrom: asIsoTimestamp(COMPLIANCE_VALID_FROM),
      assertedAt: asIsoTimestamp(COMPLIANCE_INSTANT),
      confidence: 1,
      evidenceIds: [evidence.id],
      provenance: provenance(),
    });
    const retractedAt = asIsoTimestamp(
      new Date(Date.parse(claim.bitemporal.recordedAt) + 1_000).toISOString(),
    );
    const retracted = {
      ...claim,
      status: 'retracted' as const,
      bitemporal: { ...claim.bitemporal, recordedAt: retractedAt },
    };

    await store.assertClaim(claim);
    await store.retractClaim(retracted);

    const beforeRetraction = await store.listClaims({
      tenantId: metadata.tenantId,
      temporal: { validAt: QUERY_VALID_AT, knownAt: claim.bitemporal.recordedAt },
    });
    const afterRetraction = await store.listClaims({
      tenantId: metadata.tenantId,
      temporal: { validAt: QUERY_VALID_AT, knownAt: retractedAt },
    });
    const current = await store.listClaims({ tenantId: metadata.tenantId });

    expect(beforeRetraction.some((item) => item.id === claim.id)).toBe(true);
    expect(afterRetraction.some((item) => item.id === claim.id)).toBe(false);
    expect(current.some((item) => item.id === claim.id)).toBe(false);
  });

  it('round-trips immutable retrieval receipts including authorization evidence', async () => {
    const store = await factory();
    const metadata = localStandaloneMetadata();
    const receipt = {
      ...metadata,
      id: newId('RetrievalReceiptId'),
      queryHash: 'sha256:test-query',
      temporal: { validAt: QUERY_VALID_AT, knownAt: COMPLIANCE_INSTANT },
      planVersion: 'compliance-v1',
      selected: [],
      omissions: [],
      authorizationReceipts: [],
      executedAt: asIsoTimestamp(COMPLIANCE_INSTANT),
      provenance: provenance(),
    };

    await store.putRetrievalReceipt(receipt);
    expect(await store.getRetrievalReceipt(receipt.id)).toEqual(receipt);
  });
}

function registerProjectionCompliance(factory: StoreFactory): void {
  it('ADR-0002: clearing embeddings then re-put does not change claim ids', async () => {
    const store = await factory();
    const metadata = localStandaloneMetadata();
    const entity = buildEntity({ metadata, labels: ['Embed'], provenance: provenance() });
    const { evidence } = buildEvidenceInserted({
      metadata,
      uri: 'file://embed.txt',
      contentHash: 'sha256:embed',
      mimeType: COMPLIANCE_MIME,
      provenance: provenance(),
    });
    const { claim } = buildClaimAsserted({
      metadata,
      subject: entity.id,
      predicate: 'topic',
      object: { kind: 'literal', value: 'embeddings' },
      validFrom: asIsoTimestamp(COMPLIANCE_VALID_FROM),
      assertedAt: asIsoTimestamp(COMPLIANCE_INSTANT),
      confidence: 0.8,
      evidenceIds: [evidence.id],
      provenance: provenance(),
    });

    await store.putEntity(entity);
    await store.putEvidence(evidence);
    await store.assertClaim(claim);
    await store.putEmbedding({ claimId: claim.id, vector: [0.1, 0.2, 0.3] });
    expect((await store.getClaim(claim.id))?.id).toBe(claim.id);

    await store.clearEmbeddings();
    expect(await store.listEmbeddings()).toEqual([]);

    await store.putEmbedding({ claimId: claim.id, vector: [0.4, 0.5, 0.6] });
    expect((await store.getClaim(claim.id))?.id).toBe(claim.id);
    expect(await store.listEmbeddings()).toEqual([{ claimId: claim.id, vector: [0.4, 0.5, 0.6] }]);
  });

  it('ADR-0002: rebuilding lexical projection does not change claim ids', async () => {
    const store = await factory();
    const metadata = localStandaloneMetadata();
    const entity = buildEntity({ metadata, labels: ['Lex'], provenance: provenance() });
    const { evidence } = buildEvidenceInserted({
      metadata,
      uri: 'file://lex.txt',
      contentHash: 'sha256:lex',
      mimeType: COMPLIANCE_MIME,
      provenance: provenance(),
    });
    const { claim } = buildClaimAsserted({
      metadata,
      subject: entity.id,
      predicate: 'topic',
      object: { kind: 'literal', value: 'vendor payment processor' },
      validFrom: asIsoTimestamp(COMPLIANCE_VALID_FROM),
      assertedAt: asIsoTimestamp(COMPLIANCE_INSTANT),
      confidence: 0.8,
      evidenceIds: [evidence.id],
      provenance: provenance(),
    });

    await store.putEntity(entity);
    await store.putEvidence(evidence);
    await store.assertClaim(claim);
    const before = await store.getClaim(claim.id);
    await store.rebuildLexicalProjection();
    const hits = await store.searchLexical({
      tenantId: metadata.tenantId,
      query: 'vendor processor',
      limit: 10,
    });
    expect(before?.id).toBe(claim.id);
    expect((await store.getClaim(claim.id))?.id).toBe(claim.id);
    expect(hits.some((hit) => hit.id === claim.id)).toBe(true);
  });
}

export function canonicalStoreComplianceTests(factory: StoreFactory): void {
  describe('CanonicalStore compliance', () => {
    registerCoreCompliance(factory);
    registerTemporalCompliance(factory);
    registerProjectionCompliance(factory);
  });
}
