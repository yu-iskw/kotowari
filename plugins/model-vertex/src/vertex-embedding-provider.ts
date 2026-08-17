import type { EmbeddingProvider } from '@kotowari/plugin-sdk';

import { hashEmbedding } from './hash-embedding.js';

export function createVertexEmbeddingProvider(dimensions = 8): EmbeddingProvider {
  return {
    id: 'vertex-embedding',
    async embed(request) {
      return {
        vectors: request.texts.map((text) => hashEmbedding(text, dimensions)),
      };
    },
  };
}
