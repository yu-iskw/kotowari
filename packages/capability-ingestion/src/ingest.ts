import { createHash } from 'node:crypto';

import {
  asIsoTimestamp,
  buildClaimAsserted,
  buildEntity,
  buildEvidenceInserted,
  claimText,
  compactProvenance,
  detectClaimOverlap,
  localStandaloneMetadata,
  nowIso,
} from '@kotowari/kernel';

import type { Claim, DomainEvent, Entity, Principal } from '@kotowari/kernel';
import type {
  BlobStore,
  CanonicalStore,
  EmbeddingProvider,
  ExtractionProvider,
} from '@kotowari/plugin-sdk';

export type IngestDocument = {
  relativePath: string;
  bytes: Uint8Array;
  mimeType: string;
};

export type IngestResult = {
  evidenceIds: readonly string[];
  claimIds: readonly string[];
  entityIds: readonly string[];
};

export type IngestDeps = {
  store: CanonicalStore;
  blobs: BlobStore;
  extraction: ExtractionProvider;
  embeddings: EmbeddingProvider;
  principal: Principal;
};

function isTextMime(mimeType: string): boolean {
  return mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType.endsWith('+json');
}

function ingestProvenance(principal: Principal, process: string) {
  return compactProvenance({ source: 'ingestion', actor: principal.id, process });
}

export async function ingestDocuments(deps: IngestDeps, documents: readonly IngestDocument[]): Promise<IngestResult> {
  const metadata = {
    ...localStandaloneMetadata(deps.principal.id),
    tenantId: deps.principal.tenantId,
    namespaceId: deps.principal.namespaceIds[0] ?? localStandaloneMetadata().namespaceId,
  };
  const evidenceIds: string[] = [];
  const claimIds: string[] = [];
  const entityIds: string[] = [];
  const entityByLabel = new Map<string, Entity>();

  for (const document of documents) {
    const contentHash = createHash('sha256').update(document.bytes).digest('hex');
    const blobKey = `evidence/${contentHash}/${document.relativePath}`;
    const { uri } = await deps.blobs.put(blobKey, document.bytes, document.mimeType);
    const { evidence, event: evidenceEvent } = buildEvidenceInserted({
      metadata,
      uri,
      contentHash: `sha256:${contentHash}`,
      mimeType: document.mimeType,
      title: document.relativePath,
      provenance: ingestProvenance(deps.principal, 'ingest.put_blob'),
    });

    await deps.store.withTransaction(async (tx) => {
      await tx.putEvidence(evidence);
      await tx.appendEvent(evidenceEvent);
      await tx.appendOutbox(evidenceEvent);
    });
    evidenceIds.push(evidence.id);

    const text = isTextMime(document.mimeType) ? new TextDecoder().decode(document.bytes) : document.relativePath;
    const { drafts } = await deps.extraction.extract({ text, evidenceId: evidence.id });
    const existing = await deps.store.listClaims({
      tenantId: metadata.tenantId,
      namespaceId: metadata.namespaceId,
    });
    const pending: { toStore: Claim; event: DomainEvent }[] = [];

    for (const draft of drafts) {
      const subject = await entityForLabel(deps, entityByLabel, metadata, draft.subjectLabel);
      entityIds.push(subject.id);
      const { claim, event } = buildClaimAsserted({
        metadata,
        subject: subject.id,
        predicate: normalizePredicate(draft.predicate),
        object: { kind: 'literal', value: draft.objectLiteral },
        validFrom: asIsoTimestamp('1970-01-01T00:00:00.000Z'),
        assertedAt: nowIso(),
        confidence: draft.confidence,
        evidenceIds: [evidence.id],
        provenance: ingestProvenance(deps.principal, 'ingest.extract'),
        extractor: deps.extraction.id,
        extractionVersion: '1',
      });
      const overlapping = [...existing, ...pending.map((item) => item.toStore)].filter((other) =>
        detectClaimOverlap(other, claim),
      );
      pending.push({
        toStore: overlapping.length > 0 ? { ...claim, status: 'conflicted' as const } : claim,
        event,
      });
    }

    if (pending.length === 0) {
      continue;
    }

    const { vectors } = await deps.embeddings.embed({ texts: pending.map((item) => claimText(item.toStore)) });
    for (const [index, item] of pending.entries()) {
      const vector = vectors[index] ?? [];
      await deps.store.withTransaction(async (tx) => {
        await tx.assertClaim(item.toStore);
        await tx.appendEvent(item.event);
        await tx.appendOutbox(item.event);
        await tx.putEmbedding({ claimId: item.toStore.id, vector });
      });
      claimIds.push(item.toStore.id);
    }
  }

  return { evidenceIds, claimIds, entityIds };
}

function normalizePredicate(predicate: string): string {
  return predicate.trim().toLowerCase().replaceAll(/\s+/g, '_');
}

async function entityForLabel(
  deps: IngestDeps,
  cache: Map<string, Entity>,
  metadata: ReturnType<typeof localStandaloneMetadata>,
  label: string,
): Promise<Entity> {
  const key = label.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const entity = buildEntity({
    metadata,
    labels: [label.trim()],
    provenance: ingestProvenance(deps.principal, 'ingest.entity'),
  });
  await deps.store.putEntity(entity);
  cache.set(key, entity);
  return entity;
}

export function documentMimeType(fileName: string): string {
  if (fileName.endsWith('.md')) {
    return 'text/markdown';
  }
  if (fileName.endsWith('.json')) {
    return 'application/json';
  }
  if (fileName.endsWith('.txt')) {
    return 'text/plain';
  }
  if (fileName.endsWith('.pdf')) {
    return 'application/pdf';
  }
  return 'application/octet-stream';
}
