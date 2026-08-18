export const PACKAGE_NAME = '@kotowari/agent-cursor' as const;

export { AgentCursorError } from './errors.js';
export type { AgentCursorContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';

export {
  cursorPluginManifest,
  decisionToolNames,
  decisionToolsDocument,
  retrieveToolNames,
  retrieveToolsDocument,
  type CursorPluginManifest,
  type McpToolDescriptor,
  type McpToolsDocument,
} from './cursor-pack.js';
