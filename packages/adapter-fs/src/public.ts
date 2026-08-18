export const PACKAGE_NAME = '@kotowari/adapter-fs' as const;

export { AdapterFsError } from './errors.js';
export type { AdapterFsContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { createFileBlobStore } from './file-blob-store.js';
export { createEmbeddedQueue } from './embedded-queue.js';
export { createLocalIdentityProvider } from './local-identity-provider.js';
export {
  bearerTokenFromHeaders,
  createDevOidcIdentityProvider,
  DEV_OIDC_GUEST_TOKEN,
  DEV_OIDC_LOCAL_TOKEN,
} from './dev-oidc-identity-provider.js';
