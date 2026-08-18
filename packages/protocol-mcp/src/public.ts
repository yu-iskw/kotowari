export const PACKAGE_NAME = '@kotowari/protocol-mcp' as const;

export { ProtocolMcpError } from './errors.js';
export type { ProtocolMcpContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export {
  createMcpHttpHandler,
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
export { createKotowariMcpServer } from './mcp-server.js';
export type {
  CreateKotowariMcpServerInput,
  McpAuditEvent,
  McpAuditSink,
} from './mcp-server.js';
export { handleMcpStdio, parseMcpProfileFlag } from './mcp-stdio.js';
export {
  MCP_OPERATIONS,
  invokeMcpOperation,
  mcpOperation,
} from './operation-registry.js';
export type {
  McpOperation,
  McpOperationName,
  McpOperationRisk,
} from './operation-registry.js';
