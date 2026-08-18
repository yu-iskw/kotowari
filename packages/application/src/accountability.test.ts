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

describe('accountability spine', () => {
  it('replays persisted context, retrieval authorization, and policy versions without rerunning a model', async () => {
    const base = testPorts();
    const app = createKotowariApp(base);
    await app.ingestDocuments([
      {
        relativePath: 'vendor.md',
        bytes: new TextEncoder().encode('Vendor X handles the HIPAA workload.'),
        mimeType: 'text/markdown',
      },
    ]);
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
    expect(replay?.policyVersions.length).toBeGreaterThan(0);
  });

  it('returns explainable entity resolution candidates from canonical entities', async () => {
    const app = createKotowariApp(testPorts());
    await app.ingestDocuments([
      {
        relativePath: 'vendor.md',
        bytes: new TextEncoder().encode('Vendor X handles the HIPAA workload.'),
        mimeType: 'text/markdown',
      },
    ]);

    const candidates = await app.findEntityCandidates?.({ label: 'vendor x' });
    expect(candidates?.[0]?.entity.labels).toContain('Vendor X');
    expect(candidates?.[0]?.score).toBe(1);
    expect(candidates?.[0]?.reasons[0]).toContain('exact match');
  });
});
