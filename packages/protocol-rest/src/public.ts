export const PACKAGE_NAME = '@kotowari/protocol-rest' as const;

export { ProtocolRestError } from './errors.js';
export type { ProtocolRestContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { handleRest, OPENAPI_SNAPSHOT } from './rest.js';
export type { RestRequest, RestResponse } from './rest.js';
