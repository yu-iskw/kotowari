export const PACKAGE_NAME = '@kotowari/server' as const;

export { ServerError } from './errors.js';
export type { ServerContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export {
  createStandaloneApp,
  ingestFilesystemPath,
  startKotowariServer,
  writeWorkspaceConfig,
} from './standalone.js';
