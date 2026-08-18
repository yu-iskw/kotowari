import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEV_OIDC_GUEST_TOKEN, DEV_OIDC_LOCAL_TOKEN } from '@kotowari/adapter-fs';
import { describe, expect, it } from 'vitest';

import { startComposeServer } from './compose.js';
import { startKotowariServer } from './public.js';

function overlappingDocs(): string {
  const docs = mkdtempSync(join(tmpdir(), 'docs-'));
  writeFileSync(join(docs, 'ceo.md'), 'Alice Chen is CEO of Vendor X as of 2024.\n');
  writeFileSync(join(docs, 'left.md'), 'Alice Chen is not CEO of Vendor X as of 2025.\n');
  return docs;
}

async function jsonOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe('S17 S3 honesty on SQLite and Postgres', () => {
  it('S17 SQLite retrieve prefers preferredClaimId after resolve', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kotowari-'));
    const started = await startKotowariServer({ dataDir, port: 0 });
    try {
      await fetch(`${started.url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: overlappingDocs() }),
      });
      const listed = await fetch(`${started.url}/v1/conflicts`);
      const conflicts = (await listed.json()) as { claimIds: string[] }[];
      expect(conflicts.length).toBeGreaterThan(0);
      const claimIds = conflicts[0]?.claimIds ?? [];
      const preferredClaimId = claimIds[0] ?? '';
      await fetch(`${started.url}/v1/conflicts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          claimIds,
          preferredClaimId,
          reason: 'Later filing is authoritative',
        }),
      });
      const search = await fetch(`${started.url}/v1/knowledge/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: 'Alice Chen CEO', purpose: 'search' }),
      });
      const result = (await search.json()) as { hits: { claimId: string }[] };
      expect(result.hits.some((hit) => hit.claimId === preferredClaimId)).toBe(true);
      expect(
        result.hits.some(
          (hit) => claimIds.includes(hit.claimId) && hit.claimId !== preferredClaimId,
        ),
      ).toBe(false);
    } finally {
      await started.close();
    }
  });

  it('S17 Postgres compose retrieve prefers preferredClaimId after resolve', async () => {
    const compose = await startComposeServer({ port: 0 });
    const auth = { authorization: `Bearer ${DEV_OIDC_LOCAL_TOKEN}` };
    try {
      await fetch(`${compose.url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ path: overlappingDocs() }),
      });
      const listed = await fetch(`${compose.url}/v1/conflicts`, { headers: auth });
      const conflicts = (await listed.json()) as { claimIds: string[] }[];
      expect(conflicts.length).toBeGreaterThan(0);
      const claimIds = conflicts[0]?.claimIds ?? [];
      const preferredClaimId = claimIds[0] ?? '';
      await fetch(`${compose.url}/v1/conflicts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({
          claimIds,
          preferredClaimId,
          reason: 'Later filing is authoritative',
        }),
      });
      const search = await fetch(`${compose.url}/v1/knowledge/search`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ query: 'Alice Chen CEO', purpose: 'search' }),
      });
      const result = (await search.json()) as { hits: { claimId: string }[] };
      expect(result.hits.some((hit) => hit.claimId === preferredClaimId)).toBe(true);
    } finally {
      await compose.close();
    }
  });

  it('S3 decision search survives sqlite reopen', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'kotowari-'));
    const docs = overlappingDocs();
    const first = await startKotowariServer({ dataDir, port: 0 });
    try {
      await fetch(`${first.url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: docs }),
      });
      const recorded = await fetch(`${first.url}/v1/decisions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          purpose: 'library-choice',
          query: 'What did we decide about vendor X?',
          selectedOutcome: 'use_vendor_x',
          confidence: 0.9,
        }),
      });
      expect(recorded.status).toBe(201);
    } finally {
      await first.close();
    }
    const second = await startKotowariServer({ dataDir, port: 0 });
    try {
      const found = await fetch(
        `${second.url}/v1/decisions?query=${encodeURIComponent('vendor X')}`,
      );
      const decisions = (await found.json()) as { selectedOutcome?: string }[];
      expect(decisions.some((decision) => decision.selectedOutcome === 'use_vendor_x')).toBe(true);
    } finally {
      await second.close();
    }
  });
});

describe('S5 compose door', () => {
  it('S5 ingest without Bearer is 401 and guest search omits classified hits', async () => {
    const compose = await startComposeServer({ port: 0 });
    try {
      const unauthenticated = await fetch(`${compose.url}/v1/ingest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: overlappingDocs() }),
      });
      expect(unauthenticated.status).toBe(401);
      const ingested = await fetch(`${compose.url}/v1/ingest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${DEV_OIDC_LOCAL_TOKEN}`,
        },
        body: JSON.stringify({ path: overlappingDocs() }),
      });
      expect(ingested.status).toBe(202);
      const guestWrite = await fetch(`${compose.url}/v1/ingest`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${DEV_OIDC_GUEST_TOKEN}`,
        },
        body: JSON.stringify({ path: overlappingDocs() }),
      });
      expect(guestWrite.status).toBe(403);
      const me = await jsonOf(await fetch(`${compose.url}/v1/me`));
      expect(me['roles']).toEqual(['guest']);
      const jobs = await fetch(`${compose.url}/v1/jobs`, {
        headers: { authorization: `Bearer ${DEV_OIDC_LOCAL_TOKEN}` },
      });
      const pending = (await jobs.json()) as { kind: string }[];
      expect(pending.some((job) => job.kind === 'ingest.documents')).toBe(true);
    } finally {
      await compose.close();
    }
  });
});
