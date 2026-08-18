import { evidenceBlobKey, reextractFromStoredEvidence } from '@kotowari/capability-ingestion';
import { putPolicy } from '@kotowari/capability-policy';
import { decisionToProvO } from '@kotowari/capability-provenance';
import { asDecisionId, asEvidenceId, assertAllowed } from '@kotowari/kernel';

import type { IngestResult } from '@kotowari/capability-ingestion';
import type { ProvODocument } from '@kotowari/capability-provenance';
import type { Decision, Evidence, PolicyRecord, Principal } from '@kotowari/kernel';
import type {
  BlobStore,
  CanonicalStore,
  EmbeddingProvider,
  ExtractionProvider,
  Queue,
} from '@kotowari/plugin-sdk';

type ContentPorts = {
  store: CanonicalStore;
  blobs: BlobStore;
};

type ExtractPorts = ContentPorts & {
  extraction: ExtractionProvider;
  embeddings: EmbeddingProvider;
};

function stringArrayFromUnknown(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item) => typeof item === 'string');
}

function decisionMatchesQuery(decision: Decision, query: string): boolean {
  const haystack = [
    decision.selectedOutcome,
    decision.rationale ?? '',
    decision.inputContextSnapshot.purpose,
    ...decision.alternatives,
    ...decision.policyTags,
  ]
    .join(' ')
    .toLowerCase();
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length > 1)
    .every((token) => haystack.includes(token));
}

export async function listDecisionsFor(
  store: CanonicalStore,
  actor: Principal,
): Promise<readonly Decision[]> {
  return store.listDecisions({
    tenantId: actor.tenantId,
    namespaceId: actor.namespaceIds[0],
  });
}

export async function searchDecisionsFor(
  store: CanonicalStore,
  actor: Principal,
  query: string,
): Promise<readonly Decision[]> {
  const decisions = await listDecisionsFor(store, actor);
  if (query.trim().length === 0) {
    return decisions;
  }
  return decisions.filter((decision) => decisionMatchesQuery(decision, query));
}

export async function ensureWorkspacePolicies(
  store: CanonicalStore,
  actor: Principal,
): Promise<readonly PolicyRecord[]> {
  const existing = await store.listPolicies({ tenantId: actor.tenantId });
  if (existing.length > 0) {
    return existing;
  }
  const created = await putPolicy({
    store,
    principal: actor,
    name: 'workspace-default',
    version: 1,
    rules: {},
  });
  return [created];
}

export async function exportProvOFor(
  ports: ContentPorts,
  decisionId: string,
): Promise<ProvODocument | undefined> {
  const decision = await ports.store.getDecision(asDecisionId(decisionId));
  if (decision === undefined) {
    return undefined;
  }
  const evidence = (
    await Promise.all(decision.consideredEvidenceIds.map((id) => ports.store.getEvidence(id)))
  ).filter((item): item is Evidence => item !== undefined);
  return decisionToProvO(decision, evidence);
}

export async function loadEvidenceContent(
  ports: ContentPorts,
  actor: Principal,
  id: string,
): Promise<
  | {
      evidence: Evidence;
      bytes: Uint8Array;
      contentType: string;
      text?: string;
    }
  | undefined
> {
  const evidence = await ports.store.getEvidence(asEvidenceId(id));
  if (evidence === undefined) {
    return undefined;
  }
  assertAllowed(
    actor,
    'knowledge.read',
    { kind: 'evidence', id: evidence.id, metadata: evidence },
    { tenantId: actor.tenantId },
  );
  const loaded = await ports.blobs.get(evidenceBlobKey(evidence));
  if (loaded === undefined) {
    return undefined;
  }
  const text = loaded.contentType.startsWith('text/')
    ? new TextDecoder().decode(loaded.bytes)
    : undefined;
  return {
    evidence,
    bytes: loaded.bytes,
    contentType: loaded.contentType,
    text,
  };
}

export async function drainQueuedJobs(input: {
  queue: Queue;
  store: CanonicalStore;
  reextract: (evidenceIds: readonly string[]) => Promise<IngestResult>;
  ingestPath?: (target: string) => Promise<IngestResult>;
}): Promise<number> {
  const jobs = await input.queue.drain();
  for (const job of jobs) {
    if (job.kind === 'ingest.extract') {
      await input.reextract(stringArrayFromUnknown(job.payload['evidenceIds']));
    } else if (job.kind === 'ingest.path' && typeof job.payload['path'] === 'string') {
      const ingestPath = input.ingestPath;
      if (ingestPath !== undefined) {
        await ingestPath(job.payload['path']);
      }
    } else if (job.kind === 'ingest.documents') {
      await input.store.rebuildLexicalProjection();
    }
  }
  return jobs.length;
}

export async function reextractEvidence(
  ports: ExtractPorts,
  actor: Principal,
  evidenceIds: readonly string[],
): Promise<IngestResult> {
  return reextractFromStoredEvidence(
    {
      store: ports.store,
      blobs: ports.blobs,
      extraction: ports.extraction,
      embeddings: ports.embeddings,
      principal: actor,
    },
    evidenceIds,
  );
}
