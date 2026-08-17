export const PACKAGE_NAME = '@kotowari/application' as const;

export { ApplicationError } from './errors.js';
export type { ApplicationContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { createKotowariApp } from './create-app.js';
export { dispatchIngest } from './ingest-request.js';
export type { IngestDispatch } from './ingest-request.js';
export type { KotowariApp, KotowariAppOptions, KotowariPorts } from './create-app.js';
