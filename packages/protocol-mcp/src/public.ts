export const PACKAGE_NAME = '@kotowari/protocol-mcp' as const;

export { ProtocolMcpError } from './errors.js';
export type { ProtocolMcpContracts } from './contracts.js';
export { PACKAGE_EVENTS } from './events.js';
export {
  handleMcpHttp,
  MCP_ERROR_HEADER_MISMATCH,
  MCP_PROTOCOL_VERSION,
  PROFILE_TOOLS,
  spyApplicationCommandName,
} from './mcp-http.js';
export type { McpHttpInput, McpHttpOutput, McpProfile } from './mcp-http.js';
