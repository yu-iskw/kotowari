import { KernelError, localStandalonePrincipal } from '@kotowari/kernel';
import { createMemoryBlobStore, createMemoryCanonicalStore } from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { createKotowariApp } from './public.js';

function ports() {
  const store = createMemoryCanonicalStore();
  return {
    store,
    blobs: createMemoryBlobStore(),
    identity: { currentPrincipal: async () => localStandalonePrincipal() },
    queue: {
      enqueue: async () => undefined,
      drain: async () => [],
    },
    extraction: {
      id: 'test-extract',
      extract: async ({ text }: { text: string }) => ({
        drafts: [
          {
            subjectLabel: 'Alice Chen',
            predicate: 'is',
            objectLiteral: 'CEO of Vendor X as of 2024',
            confidence: 0.9,
          },
          {
            subjectLabel: 'document',
            predicate: 'mentions',
            objectLiteral: text.slice(0, 80),
            confidence: 1,
          },
        ],
      }),
    },
    embeddings: {
      id: 'test-embed',
      embed: async ({ texts }: { texts: readonly string[] }) => ({
        vectors: texts.map((text) => {
          const vector = [0, 0, 0, 0, 0, 0, 0, 0];
          for (let i = 0; i < text.length; i += 1) {
            const slot = i % 8;
            vector[slot] = (vector[slot] ?? 0) + text.charCodeAt(i);
          }
          return vector;
        }),
      }),
    },
  };
}

describe('S2 ingest then sourced search', () => {
  it('S2 ingest then query returns claims linked to evidence', async () => {
    const app = createKotowariApp(ports());
    const text = 'Alice Chen is CEO of Vendor X as of 2024. Vendor X is the payment processor.';
    const ingested = await app.ingestDocuments([
      {
        relativePath: 'decision-note.md',
        bytes: new TextEncoder().encode(text),
        mimeType: 'text/markdown',
      },
    ]);
    expect(ingested.claimIds.length).toBeGreaterThan(0);
    expect(ingested.evidenceIds.length).toBeGreaterThan(0);

    const result = await app.searchKnowledge({ query: 'Vendor X CEO', purpose: 'search' });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits[0]?.evidenceIds.length).toBeGreaterThan(0);
    expect(result.hits[0]?.whySelected).toBeTruthy();
  });
});

describe('S3 decision persistence', () => {
  it('S3 records a decision with a context snapshot', async () => {
    const app = createKotowariApp(ports());
    await app.ingestDocuments([
      {
        relativePath: 'note.md',
        bytes: new TextEncoder().encode(
          'Vendor X is the payment processor for the HIPAA workload.',
        ),
        mimeType: 'text/markdown',
      },
    ]);
    const decision = await app.recordDecision({
      purpose: 'library-choice',
      query: 'Vendor X',
      selectedOutcome: 'use_vendor_x',
      confidence: 0.8,
      rationale: 'HIPAA workload needs a sourced processor',
    });
    expect(decision.inputContextSnapshot.purpose).toBe('library-choice');
    expect(decision.consideredEvidenceIds.length).toBeGreaterThan(0);
    const loaded = await app.getDecision(decision.id);
    expect(loaded?.id).toBe(decision.id);
  });

  it('ADR-0008 rejects chainOfThought on recordDecision', async () => {
    const app = createKotowariApp(ports());
    await expect(
      app.recordDecision({
        purpose: 'x',
        selectedOutcome: 'y',
        confidence: 0.5,
        chainOfThought: 'secret',
      }),
    ).rejects.toBeInstanceOf(KernelError);
  });
});

describe('S10 classified omission', () => {
  it('S10 classified evidence omitted with policy_filter explanation', async () => {
    const base = ports();
    const writer = createKotowariApp(base);
    await writer.ingestDocuments([
      {
        relativePath: 'secret.md',
        bytes: new TextEncoder().encode('Vendor X is classified internally.'),
        mimeType: 'text/markdown',
      },
    ]);
    const reader = createKotowariApp({
      ...base,
      identity: {
        currentPrincipal: async () => ({
          ...localStandalonePrincipal(),
          clearance: 'public',
        }),
      },
    });
    const result = await reader.searchKnowledge({ query: 'Vendor X', purpose: 'search' });
    expect(result.hits).toEqual([]);
    expect(result.omitted.length).toBeGreaterThan(0);
    expect(result.omitted[0]?.count).toBeGreaterThan(0);
  });
});
