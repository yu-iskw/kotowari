export const PACKAGE_NAME = '@kotowari/worker' as const;

export { WorkerError } from './errors.js';
export type { WorkerContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { runWorkerLoop, runWorkerOnce } from './process-jobs.js';
export { createProjectionOperations } from './projection-operations.js';
export type {
  ProjectionOperationalStatus,
  ProjectionOperations,
  ProjectionOperationsOptions,
} from './projection-operations.js';
export { startWorker } from './worker.js';
export type { WorkerHandle } from './worker.js';
