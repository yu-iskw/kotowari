import { localStandalonePrincipal } from '@kotowari/kernel';
import { createMemoryBlobStore, createMemoryCanonicalStore } from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { createKotowariApp } from './public.js';

function testPorts() {
  const jobs: { kind: string; payload: Record<string, unknown> }[] = [];
  return {
    store: createMemoryCanonicalStore(),
    blobs: createMemoryBlobStore(),
    identity: { currentPrincipal: async () => localStandalonePrincipal() },
    queue: {
      enqueue: async (job: { kind: string; payload: Record<string, unknown> }) => {
        jobs.push(job);
      },
      drain: async () => {
        const drained = [...jobs];
        jobs.length = 0;
        return drained;
      },
    },
    extraction: {
      id: 'accountability-test-extractor',
      extract: async () => ({
        drafts: [
          {
            subjectLabel: 'Vendor X',
            predicate: 'handles',
            objectLiteral: 'HIPAA workload',
            confidence: 0.95,
          },
        ],
      }),
    },
    embeddings: {
      id: 'accountability-test-embedder',
      embed: async ({ texts }: { texts: readonly string[] }) => ({
        vectors: texts.map((text) => [text.length, 1, 0, 1]),
      }),
    },
  };
}

async function ingestVendor(app: ReturnType<typeof createKotowariApp>) {
  await app.ingestDocuments([
    {
      relativePath: 'vendor.md',
      bytes: new TextEncoder().encode('Vendor X handles the HIPAA workload.'),
      mimeType: 'text/markdown',
    },
  ]);
}

describe('accountability spine', () => {
  it('replays persisted context, retrieval authorization, and explicit policy versions without rerunning a model', async () => {
    const base = testPorts();
    const app = createKotowariApp(base);
    await ingestVendor(app);
    await app.putPolicy({
      name: 'vendor-review-policy',
      version: 1,
      rules: { allowedOutcomes: ['approve', 'reject'] },
    });

    const decision = await app.recordDecision({
      purpose: 'vendor-review',
      query: 'Vendor X',
      selectedOutcome: 'approve',
      confidence: 0.9,
    });
    const replay = await app.replayDecision?.(decision.id);

    expect(replay?.complete).toBe(true);
    expect(replay?.decision.id).toBe(decision.id);
    expect(replay?.retrievalReceipt?.authorizationReceipts.length).toBeGreaterThan(0);
    expect(replay?.contextSnapshot.policyVersions).toHaveLength(1);
    expect(replay?.policyVersions).toHaveLength(1);
  });

  it('does not mutate governance state when recording a decision with no applicable policies', async () => {
    const app = createKotowariApp(testPorts());
    await ingestVendor(app);

    const decision = await app.recordDecision({
      purpose: 'ungoverned-review',
      query: 'Vendor X',
      selectedOutcome: 'approve',
      confidence: 0.9,
    });

    expect(await app.listPolicies()).toEqual([]);
    expect(decision.inputContextSnapshot.policyVersions).toEqual([]);
    expect(decision.applicablePolicyIds).toEqual([]);
    expect(decision.policyEvaluations).toEqual([]);
  });

  it('builds a hashed audit bundle from persisted accountability records', async () => {
    const app = createKotowariApp(testPorts());
    await ingestVendor(app);
    await app.putPolicy({ name: 'audit-policy', version: 1, rules: {} });
    const decision = await app.recordDecision({
      purpose: 'audit',
      query: 'Vendor X',
      selectedOutcome: 'approve',
      confidence: 0.9,
    });

    const bundle = await app.getDecisionAuditBundle?.(decision.id);

    expect(bundle?.decision.id).toBe(decision.id);
    expect(bundle?.claims.length).toBeGreaterThan(0);
    expect(bundle?.evidence.length).toBeGreaterThan(0);
    expect(bundle?.policyVersions).toHaveLength(1);
    expect(bundle?.authorizationReceipts.length).toBeGreaterThan(0);
    expect(bundle?.manifest.schemaVersion).toBe('decision-audit-v1');
    expect(bundle?.manifest.contentHashes['decision']).toHaveLength(64);
  });

  it('returns explainable entity resolution candidates from canonical entities', async () => {
    const app = createKotowariApp(testPorts());
    await ingestVendor(app);

    const candidates = await app.findEntityCandidates?.({ label: 'vendor x' });
    expect(candidates?.[0]?.entity.labels).toContain('Vendor X');
    expect(candidates?.[0]?.score).toBe(1);
    expect(candidates?.[0]?.reasons[0]).toContain('exact match');
  });
});
