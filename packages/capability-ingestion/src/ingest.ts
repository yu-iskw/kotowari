import { createHash } from 'node:crypto';

import {
  asEvidenceId,
  asIsoTimestamp,
  buildClaimAsserted,
  buildConflictDetected,
  buildEntity,
  buildEvidenceInserted,
  claimText,
  compactProvenance,
  detectClaimOverlap,
  localStandaloneMetadata,
  nowIso,
} from '@kotowari/kernel';

import type { Claim, Conflict, DomainEvent, Entity, Principal } from '@kotowari/kernel';
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
  return (
    mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType.endsWith('+json')
  );
}

function ingestProvenance(principal: Principal, process: string) {
  return compactProvenance({ source: 'ingestion', actor: principal.id, process });
}

export async function ingestDocuments(
  deps: IngestDeps,
  documents: readonly IngestDocument[],
): Promise<IngestResult> {
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

    const text = isTextMime(document.mimeType)
      ? new TextDecoder().decode(document.bytes)
      : document.relativePath;
    const extracted = await persistExtractedClaims(
      deps,
      metadata,
      entityByLabel,
      evidence.id,
      text,
    );
    claimIds.push(...extracted.claimIds);
    entityIds.push(...extracted.entityIds);
  }

  return { evidenceIds, claimIds, entityIds };
}

export async function reextractFromStoredEvidence(
  deps: IngestDeps,
  evidenceIds: readonly string[],
): Promise<IngestResult> {
  const metadata = {
    ...localStandaloneMetadata(deps.principal.id),
    tenantId: deps.principal.tenantId,
    namespaceId: deps.principal.namespaceIds[0] ?? localStandaloneMetadata().namespaceId,
  };
  const claimIds: string[] = [];
  const entityIds: string[] = [];
  const entityByLabel = new Map<string, Entity>();
  const keptEvidenceIds: string[] = [];

  for (const id of evidenceIds) {
    const evidence = await deps.store.getEvidence(asEvidenceId(id));
    if (evidence === undefined) {
      continue;
    }
    const blob = await deps.blobs.get(evidenceBlobKey(evidence));
    if (blob === undefined) {
      continue;
    }
    keptEvidenceIds.push(evidence.id);
    const text = isTextMime(blob.contentType)
      ? new TextDecoder().decode(blob.bytes)
      : (evidence.title ?? evidence.id);
    const extracted = await persistExtractedClaims(
      deps,
      metadata,
      entityByLabel,
      evidence.id,
      text,
    );
    claimIds.push(...extracted.claimIds);
    entityIds.push(...extracted.entityIds);
  }

  return { evidenceIds: keptEvidenceIds, claimIds, entityIds };
}

async function persistExtractedClaims(
  deps: IngestDeps,
  metadata: ReturnType<typeof localStandaloneMetadata>,
  entityByLabel: Map<string, Entity>,
  evidenceId: string,
  text: string,
): Promise<{ claimIds: string[]; entityIds: string[] }> {
  const { drafts } = await deps.extraction.extract({ text, evidenceId: asEvidenceId(evidenceId) });
  const existing = await deps.store.listClaims({
    tenantId: metadata.tenantId,
    namespaceId: metadata.namespaceId,
  });
  const pending: { toStore: Claim; event: DomainEvent }[] = [];
  const conflicts: Conflict[] = [];
  const entityIds: string[] = [];

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
      evidenceIds: [asEvidenceId(evidenceId)],
      provenance: ingestProvenance(deps.principal, 'ingest.extract'),
      extractor: deps.extraction.id,
      extractionVersion: '1',
    });
    const overlapping = [...existing, ...pending.map((item) => item.toStore)].filter((other) =>
      detectClaimOverlap(other, claim),
    );
    if (overlapping.length > 0) {
      const overlapIds = new Set(overlapping.map((other) => other.id));
      for (const item of pending) {
        if (overlapIds.has(item.toStore.id)) {
          item.toStore = { ...item.toStore, status: 'conflicted' };
        }
      }
      pending.push({
        toStore: { ...claim, status: 'conflicted' },
        event,
      });
      conflicts.push(
        buildConflictDetected({
          metadata,
          kind: 'value',
          claimIds: [claim.id, ...overlapping.map((other) => other.id)],
        }),
      );
    } else {
      pending.push({
        toStore: claim,
        event,
      });
    }
  }

  const claimIds: string[] = [];
  if (pending.length === 0) {
    return { claimIds, entityIds };
  }

  const { vectors } = await deps.embeddings.embed({
    texts: pending.map((item) => claimText(item.toStore)),
  });
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
  const pendingIds = new Set(claimIds);
  const existingToMark = new Set<string>();
  for (const conflict of conflicts) {
    for (const id of conflict.claimIds) {
      if (!pendingIds.has(id)) {
        existingToMark.add(id);
      }
    }
  }
  if (conflicts.length > 0) {
    await deps.store.withTransaction(async (tx) => {
      for (const id of existingToMark) {
        const loaded = await tx.getClaim(id);
        if (loaded !== undefined && loaded.status !== 'conflicted') {
          await tx.assertClaim({ ...loaded, status: 'conflicted' });
        }
      }
      for (const conflict of conflicts) {
        await tx.putConflict(conflict);
      }
    });
  }
  return { claimIds, entityIds };
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

export function evidenceBlobKey(evidence: { contentHash: string; title?: string }): string {
  const digest = evidence.contentHash.replace(/^sha256:/, '');
  const name = evidence.title ?? 'blob';
  return `evidence/${digest}/${name}`;
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
