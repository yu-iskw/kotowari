import { createHash } from 'node:crypto';

import {
  asIsoTimestamp,
  buildClaimAsserted,
  buildEntity,
  buildEvidenceInserted,
  detectClaimOverlap,
  localStandaloneMetadata,
} from '@kotowari/kernel';

import type { Entity, Principal, Claim } from '@kotowari/kernel';
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

function provenance(principal: Principal, process: string) {
  return {
    source: 'ingestion',
    actor: principal.id,
    process,
    timestamp: asIsoTimestamp(new Date().toISOString()),
    parentIds: [] as const,
  };
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
      provenance: provenance(deps.principal, 'ingest.put_blob'),
    });

    await deps.store.withTransaction(async (tx) => {
      await tx.putEvidence(evidence);
      await tx.appendEvent(evidenceEvent);
      await tx.appendOutbox(evidenceEvent);
    });
    evidenceIds.push(evidence.id);

    const text = isTextMime(document.mimeType) ? new TextDecoder().decode(document.bytes) : document.relativePath;
    const { drafts } = await deps.extraction.extract({ text, evidenceId: evidence.id });
    for (const draft of drafts) {
      const subject = await entityForLabel(deps, entityByLabel, metadata, draft.subjectLabel, deps.principal);
      entityIds.push(subject.id);
      const { claim, event } = buildClaimAsserted({
        metadata,
        subject: subject.id,
        predicate: normalizePredicate(draft.predicate),
        object: { kind: 'literal', value: draft.objectLiteral },
        validFrom: asIsoTimestamp('1970-01-01T00:00:00.000Z'),
        assertedAt: asIsoTimestamp(new Date().toISOString()),
        confidence: draft.confidence,
        evidenceIds: [evidence.id],
        provenance: provenance(deps.principal, 'ingest.extract'),
        extractor: deps.extraction.id,
        extractionVersion: '1',
      });
      const existing = await deps.store.listClaims({ tenantId: metadata.tenantId, namespaceId: metadata.namespaceId });
      const overlapping = existing.filter((other) => detectClaimOverlap(other, claim));
      const toStore = overlapping.length > 0 ? { ...claim, status: 'conflicted' as const } : claim;
      const { vectors } = await deps.embeddings.embed({ texts: [claimText(toStore)] });
      const vector = vectors[0] ?? [];
      await deps.store.withTransaction(async (tx) => {
        await tx.assertClaim(toStore);
        await tx.appendEvent(event);
        await tx.appendOutbox(event);
        await tx.putEmbedding({ claimId: toStore.id, vector });
      });
      claimIds.push(toStore.id);
    }
  }

  return { evidenceIds, claimIds, entityIds };
}

function normalizePredicate(predicate: string): string {
  return predicate.trim().toLowerCase().replaceAll(/\s+/g, '_');
}

function claimText(claim: Claim): string {
  const object = claim.object.kind === 'literal' ? claim.object.value : claim.object.entityId;
  return `${claim.predicate} ${object}`;
}

async function entityForLabel(
  deps: IngestDeps,
  cache: Map<string, Entity>,
  metadata: ReturnType<typeof localStandaloneMetadata>,
  label: string,
  principal: Principal,
): Promise<Entity> {
  const key = label.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  const entity = buildEntity({
    metadata,
    labels: [label.trim()],
    provenance: provenance(principal, 'ingest.entity'),
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
