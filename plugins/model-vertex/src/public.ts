export const PACKAGE_NAME = '@kotowari/model-vertex' as const;

export { ModelVertexError } from './errors.js';
export type { ModelVertexContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';

export {
  createVertexModelProvider,
  DEFAULT_VERTEX_FIXTURES,
  type VertexModelProviderOptions,
} from './vertex-model-provider.js';
export { createVertexEmbeddingProvider } from './vertex-embedding-provider.js';
export { hashEmbedding } from './hash-embedding.js';
