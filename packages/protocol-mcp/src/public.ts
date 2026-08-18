export const PACKAGE_NAME = '@kotowari/protocol-mcp' as const;

export { ProtocolMcpError } from './errors.js';
export type { ProtocolMcpContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export {
  createMcpHttpHandler,
  createStandaloneMcpHttpHandler,
  protectedResourceMetadata,
} from './mcp-http.js';
export type {
  McpAuthorization,
  McpFetchHandler,
  McpTokenVerifier,
  McpVerifiedToken,
} from './mcp-http.js';
export {
  MCP_PROFILE_DEFINITIONS,
  MCP_PROFILES,
  PROFILE_TOOLS,
  isMcpProfile,
} from './mcp-profiles.js';
export type { McpProfile, McpProfileDefinition } from './mcp-profiles.js';
export {
  DEFAULT_MCP_STANDALONE_PRESET,
  MCP_STANDALONE_PRESETS,
  MCP_STANDALONE_PRESET_TOOLS,
  isMcpStandalonePreset,
} from './mcp-presets.js';
export type { McpStandalonePreset } from './mcp-presets.js';
export { createKotowariMcpServer } from './mcp-server.js';
export type { CreateKotowariMcpServerInput, McpAuditEvent, McpAuditSink } from './mcp-server.js';
export { handleMcpStdio, parseMcpStandalonePresetFlag } from './mcp-stdio.js';
export { MCP_OPERATIONS, invokeMcpOperation, mcpOperation } from './operation-registry.js';
export type { McpOperation, McpOperationName, McpOperationRisk } from './operation-registry.js';
