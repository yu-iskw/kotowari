import { KernelError, localStandalonePrincipal } from '@kotowari/kernel';
import { createMemoryBlobStore, createMemoryCanonicalStore } from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { createKotowariApp } from './public.js';

function ports() {
  const store = createMemoryCanonicalStore();
  const jobs: { kind: string; payload: Record<string, unknown> }[] = [];
  return {
    store,
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
      listPending: async () => [...jobs],
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
    expect(decision.applicablePolicyIds.length).toBeGreaterThan(0);
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
    expect(result.omitted[0]?.reason).toBe('policy_filter');
  });
});

describe('S2 evidence locker and S8 audit export', () => {
  it('S2 returns stored file bytes for ingested evidence', async () => {
    const app = createKotowariApp(ports());
    const text = 'Alice Chen is CEO of Vendor X as of 2024.';
    const ingested = await app.ingestDocuments([
      {
        relativePath: 'decision-note.md',
        bytes: new TextEncoder().encode(text),
        mimeType: 'text/markdown',
      },
    ]);
    const evidenceId = ingested.evidenceIds[0];
    expect(evidenceId).toBeDefined();
    const content = await app.getEvidenceContent(evidenceId ?? '');
    expect(content?.text).toContain('Vendor X');
    expect(content?.contentType).toBe('text/markdown');
  });

  it('S8 exports PROV-O JSON for a recorded decision', async () => {
    const app = createKotowariApp(ports());
    await app.ingestDocuments([
      {
        relativePath: 'note.md',
        bytes: new TextEncoder().encode('Vendor X is the payment processor.'),
        mimeType: 'text/markdown',
      },
    ]);
    const decision = await app.recordDecision({
      purpose: 'audit',
      query: 'Vendor X',
      selectedOutcome: 'use_vendor_x',
      confidence: 0.8,
    });
    const prov = await app.exportProvO(decision.id);
    expect(prov?.['@type']).toBeDefined();
    expect(decision.inputContextSnapshot).toBeDefined();
    expect(decision.applicablePolicyIds.length).toBeGreaterThan(0);
  });
});

describe('S17 competing truths', () => {
  it('S17 ingest overlap persists a conflict and retrieval prefers preferredClaimId', async () => {
    const base = ports();
    const overlapping = {
      ...base,
      extraction: {
        id: 'overlap-extract',
        extract: async () => ({
          drafts: [
            {
              subjectLabel: 'Alice Chen',
              predicate: 'is',
              objectLiteral: 'CEO of Vendor X as of 2024',
              confidence: 0.9,
            },
            {
              subjectLabel: 'Alice Chen',
              predicate: 'is',
              objectLiteral: 'not CEO of Vendor X as of 2025',
              confidence: 0.8,
            },
          ],
        }),
      },
    };
    const app = createKotowariApp(overlapping);
    await app.ingestDocuments([
      {
        relativePath: 'people.md',
        bytes: new TextEncoder().encode('Alice Chen personnel notes.'),
        mimeType: 'text/markdown',
      },
    ]);
    const conflicts = await app.listConflicts();
    expect(conflicts.length).toBeGreaterThan(0);
    const claimIds = conflicts[0]?.claimIds ?? [];
    expect(claimIds.length).toBeGreaterThanOrEqual(2);
    const preferredClaimId = claimIds[0] ?? '';
    const secondId = claimIds[1];
    expect(secondId).toBeDefined();
    const suppressedId = claimIds.find((id) => id !== preferredClaimId);
    expect(suppressedId).toBeDefined();
    await app.resolveConflict({
      claimIds: [preferredClaimId, secondId ?? preferredClaimId],
      preferredClaimId,
      reason: 'Later filing is authoritative',
    });
    const result = await app.searchKnowledge({ query: 'Alice Chen CEO', purpose: 'search' });
    expect(result.hits.some((hit) => hit.claimId === preferredClaimId)).toBe(true);
    expect(result.hits.some((hit) => hit.claimId === suppressedId)).toBe(false);
  });
});

describe('S3 decision precedents', () => {
  it('S3 searchDecisions finds a recorded outcome by query text', async () => {
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
    await app.recordDecision({
      purpose: 'library-choice',
      query: 'What did we decide about vendor X?',
      selectedOutcome: 'use_vendor_x',
      confidence: 0.8,
      rationale: 'HIPAA workload needs a sourced processor',
    });
    const hits = await app.searchDecisions({ query: 'vendor X HIPAA' });
    expect(hits.some((decision) => decision.selectedOutcome === 'use_vendor_x')).toBe(true);
    expect(await app.searchDecisions({ query: 'unrelated widget' })).toEqual([]);
  });
});

describe('S18 re-extract and queued jobs', () => {
  it('S18 reextracts claims from stored blob ids only', async () => {
    const app = createKotowariApp(ports());
    const ingested = await app.ingestDocuments([
      {
        relativePath: 'note.md',
        bytes: new TextEncoder().encode('Alice Chen is CEO of Vendor X as of 2024.'),
        mimeType: 'text/markdown',
      },
    ]);
    const evidenceId = ingested.evidenceIds[0];
    expect(evidenceId).toBeDefined();
    const again = await app.reextractFromEvidence([evidenceId ?? '']);
    expect(again.evidenceIds).toEqual([evidenceId]);
    expect(again.claimIds.length).toBeGreaterThan(0);
  });

  it('processQueuedJobs rebuilds the lexical projection without changing claim ids', async () => {
    const app = createKotowariApp(ports());
    const ingested = await app.ingestDocuments([
      {
        relativePath: 'note.md',
        bytes: new TextEncoder().encode('Vendor X is the payment processor.'),
        mimeType: 'text/markdown',
      },
    ]);
    const processed = await app.processQueuedJobs();
    expect(processed).toBeGreaterThan(0);
    const search = await app.searchKnowledge({ query: 'Vendor X', purpose: 'search' });
    expect(search.hits.some((hit) => ingested.claimIds.includes(hit.claimId))).toBe(true);
    expect(await app.processQueuedJobs()).toBe(0);
  });
});
