export const PACKAGE_NAME = '@kotowari/server' as const;

export { ServerError } from './errors.js';
export type { ServerContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export {
  createStandaloneApp,
  ingestFilesystemPath,
  runKotowariMcpStdio,
  startKotowariServer,
  writeWorkspaceConfig,
} from './standalone.js';
export {
  createComposeApp,
  createComposeAppFromEnv,
  createInProcessComposeApp,
  startComposeServer,
} from './compose.js';
export {
  createComposeRetrievalProjectionFromEnv,
  createComposeRetrievalProjectionRuntimeFromEnv,
} from './retrieval-projection-operations.js';
export type {
  RetrievalProjectionMaintenance,
  RetrievalProjectionStatus,
} from './retrieval-projection-operations.js';
export { createProjectionServingGate } from './projection-serving.js';
export type {
  ProjectionServingGate,
  ProjectionServingSnapshot,
  VectorRolloutMode,
  VectorRolloutPolicy,
} from './projection-serving.js';
export { listenKotowariHttp } from './http-server.js';
export type {
  McpHttpSecurityOptions,
  ServerMcpAuditEvent,
  ServerObservability,
} from './http-server.js';
export { collectParitySnapshot, semanticParityEqual } from './parity.js';
export type { ParitySnapshot } from './parity.js';
