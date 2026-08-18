export const PACKAGE_NAME = '@kotowari/protocol-mcp' as const;

export { ProtocolMcpError } from './errors.js';
export type { ProtocolMcpContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export { handleMcpHttp, MCP_ERROR_HEADER_MISMATCH } from './mcp-http.js';
export type { McpHttpInput, McpHttpOutput } from './mcp-http.js';
export { MCP_PROFILES, PROFILE_TOOLS, isMcpProfile } from './mcp-profiles.js';
export type { McpProfile } from './mcp-profiles.js';
export { handleMcpRpc, MCP_PROTOCOL_VERSION, spyApplicationCommandName } from './mcp-rpc.js';
export { handleMcpStdio, parseMcpProfileFlag } from './mcp-stdio.js';
export { TOOL_SCHEMAS, toolDescriptor } from './tool-schemas.js';
export type { JsonSchemaObject, McpToolSchema } from './tool-schemas.js';
