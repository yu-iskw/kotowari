export const PACKAGE_NAME = '@kotowari/worker' as const;

export { WorkerError } from './errors.js';
export type { WorkerContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { runWorkerLoop, runWorkerOnce } from './process-jobs.js';
export { startWorker } from './worker.js';
