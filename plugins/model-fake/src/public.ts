export const PACKAGE_NAME = '@kotowari/model-fake' as const;

export { ModelFakeError } from './errors.js';
export type { ModelFakeContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';

export { createFakeModelProvider } from './fake-model-provider.js';
export { createFakeEmbeddingProvider } from './fake-embedding-provider.js';
export { createFakeExtractionProvider } from './fake-extraction-provider.js';
export { createFakeRerankerProvider } from './fake-reranker-provider.js';
export { createFakeKnowledgeSource, type FakeKnowledgeFile } from './fake-knowledge-source.js';
export { hashEmbedding } from './hash-embedding.js';
