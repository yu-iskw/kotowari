export const PACKAGE_NAME = '@kotowari/adapter-postgres' as const;

export { AdapterPostgresError } from './errors.js';
export type { AdapterPostgresContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export {
  createPgCanonicalStore,
  createPgliteCanonicalStore,
  createPostgresCanonicalStore,
} from './postgres-store.js';
export { createPostgresQueue } from './postgres-queue.js';
export { createPgPoolClient, createPgliteClient } from './sql-client.js';
export type { SqlClient } from './sql-client.js';
