import { hashEmbedding } from './hash-embedding.js';

import type { EmbeddingProvider } from '@kotowari/plugin-sdk';

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
