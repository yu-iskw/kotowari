export const PACKAGE_NAME = '@kotowari/application' as const;

export { ApplicationError } from './errors.js';
export type { ApplicationContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { createKotowariApp } from './create-app.js';
export type { KotowariApp, KotowariPorts } from './create-app.js';
