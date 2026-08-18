export const PACKAGE_NAME = '@kotowari/adapter-s3' as const;

export { AdapterS3Error } from './errors.js';
export type { AdapterS3Contracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { createS3BlobStore, signS3Request } from './s3-blob-store.js';
export type { S3BlobStoreOptions, SignS3RequestInput, SignedS3Headers } from './s3-blob-store.js';
export { startInProcessS3 } from './in-process-s3.js';
