export const PACKAGE_NAME = '@kotowari/plugin-sdk';

export { PluginSdkError, PLUGIN_SDK_ERROR_CODES } from './errors.js';
export type { PluginSdkErrorCode } from './errors.js';

export * from './contracts.js';
export * from './events.js';
export * from './ports.js';

export { canonicalStoreComplianceTests } from './compliance/canonical-store.js';
export { blobStoreComplianceTests } from './compliance/blob-store.js';
export {
  embeddingProviderComplianceTests,
  modelProviderComplianceTests,
} from './compliance/model-provider.js';
export {
  knowledgeSourceComplianceTests,
  type KnowledgeSource,
  type SourceContext,
  type SourceObject,
} from './compliance/knowledge-source.js';

export {
  assertPackageBoundaries,
  findRepoRoot,
  type BoundaryResult,
  type PackageBoundary,
} from './architecture/boundary.js';

export {
  ftsMatchQuery,
  lexicalScore,
  lexicalTokens,
  postgresFtsQuery,
  rankClaimsLexically,
} from './lexical-search.js';
export { createMemoryBlobStore, createMemoryCanonicalStore } from './fakes/memory-store.js';
export { bearerTokenFromHeaders } from './http-headers.js';
