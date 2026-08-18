export const PACKAGE_NAME = '@kotowari/agent-cursor' as const;

export { AgentCursorError } from './errors.js';
export type { AgentCursorContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';

export { cursorPluginManifest, type CursorPluginManifest } from './cursor-pack.js';
