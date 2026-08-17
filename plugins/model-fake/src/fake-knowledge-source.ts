import {
  asIsoTimestamp,
  asPrincipalId,
  buildEvidenceInserted,
  localStandaloneMetadata,
  type KnowledgeSource,
  type SourceObject,
} from '@kotowari/plugin-sdk';

export type FakeKnowledgeFile = {
  id: string;
  uri: string;
  mimeType: string;
  text: string;
};

function contentHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) | 0;
  }
  return `sha256:fake-${(hash >>> 0).toString(16)}`;
}

export function createFakeKnowledgeSource(files: readonly FakeKnowledgeFile[]): KnowledgeSource {
  const byId = new Map(files.map((file) => [file.id, file]));

  return {
    async *discover() {
      for (const file of files) {
        yield {
          id: file.id,
          uri: file.uri,
          mimeType: file.mimeType,
          contentHash: contentHash(file.text),
        } satisfies SourceObject;
      }
    },
    async ingest(object) {
      const file = byId.get(object.id);
      if (file === undefined) {
        throw new Error(`Unknown knowledge object id: ${object.id}`);
      }

      const { evidence } = buildEvidenceInserted({
        metadata: localStandaloneMetadata(),
        uri: object.uri,
        contentHash: object.contentHash ?? contentHash(file.text),
        mimeType: object.mimeType,
        provenance: {
          source: 'fake-knowledge-source',
          actor: asPrincipalId('local-user'),
          process: 'ingest',
          timestamp: asIsoTimestamp(new Date().toISOString()),
          parentIds: [],
        },
      });
      return evidence;
    },
  };
}
