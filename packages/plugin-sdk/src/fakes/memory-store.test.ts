import { describe } from 'vitest';

import { blobStoreComplianceTests } from '../compliance/blob-store.js';
import { canonicalStoreComplianceTests } from '../compliance/canonical-store.js';
import { knowledgeSourceComplianceTests } from '../compliance/knowledge-source.js';
import {
  embeddingProviderComplianceTests,
  modelProviderComplianceTests,
} from '../compliance/model-provider.js';
import {
  asEvidenceId,
  asIsoTimestamp,
  asPrincipalId,
  buildEvidenceInserted,
  localStandaloneMetadata,
  newId,
} from '../contracts.js';
import type { EmbeddingProvider, ModelProvider } from '../ports.js';
import type { KnowledgeSource } from '../compliance/knowledge-source.js';
import { createMemoryBlobStore, createMemoryCanonicalStore } from './memory-store.js';

describe('memory fakes satisfy compliance suites', () => {
  canonicalStoreComplianceTests(() => createMemoryCanonicalStore());
  blobStoreComplianceTests(() => createMemoryBlobStore());

  modelProviderComplianceTests(
    (): ModelProvider => ({
      id: 'memory-model',
      capabilities: {
        tools: false,
        structuredOutput: true,
        images: false,
        audio: false,
        reasoning: false,
        embeddings: false,
      },
      async generate(request) {
        return { text: `echo: ${request.prompt}` };
      },
    }),
  );

  embeddingProviderComplianceTests(
    (): EmbeddingProvider => ({
      id: 'memory-embeddings',
      async embed(request) {
        return {
          vectors: request.texts.map((text, index) => [text.length, index + 1]),
        };
      },
    }),
  );

  knowledgeSourceComplianceTests(
    (): KnowledgeSource => ({
      async *discover() {
        yield {
          id: 'doc-1',
          uri: 'memory://doc-1',
          mimeType: 'text/plain',
          title: 'Sample',
          contentHash: 'sha256:sample',
        };
      },
      async ingest(object) {
        const { evidence } = buildEvidenceInserted({
          metadata: localStandaloneMetadata(),
          uri: object.uri,
          contentHash: object.contentHash ?? 'sha256:unknown',
          mimeType: object.mimeType,
          title: object.title,
          provenance: {
            source: 'memory-knowledge-source',
            actor: asPrincipalId('local-user'),
            process: 'ingest',
            timestamp: asIsoTimestamp(new Date().toISOString()),
            parentIds: [],
          },
        });
        return { ...evidence, id: asEvidenceId(newId('EvidenceId')) };
      },
    }),
  );
});
