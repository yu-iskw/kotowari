import { hashEmbedding } from './hash-embedding.js';

import type { EmbeddingProvider } from '@kotowari/plugin-sdk';


export function createFakeEmbeddingProvider(dimensions = 8): EmbeddingProvider {
  return {
    id: 'fake-embedding',
    async embed(request) {
      return {
        vectors: request.texts.map((text) => hashEmbedding(text, dimensions)),
      };
    },
  };
}
