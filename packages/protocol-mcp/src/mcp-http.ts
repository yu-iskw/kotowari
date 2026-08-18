import { handleMcpRpc, MCP_PROTOCOL_VERSION } from './mcp-rpc.js';

import type { McpProfile } from './mcp-profiles.js';
import type { McpRpcResult } from './mcp-rpc.js';
import type { KotowariApp } from '@kotowari/application';

export const MCP_ERROR_HEADER_MISMATCH = -32020;

export type McpHttpInput = {
  profile: McpProfile;
  headers: Record<string, string | undefined>;
  body: unknown;
  app: KotowariApp;
};

export type McpHttpOutput = {
  status: number;
  json: unknown;
};

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}

function asObject(value: unknown): {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: { name?: string };
} {
  if (value !== null && typeof value === 'object') {
    return value;
  }
  return {};
}

function rpcToHttp(rpc: McpRpcResult): McpHttpOutput {
  if (rpc.error !== undefined) {
    const status = rpc.error.code === -32001 ? 403 : 400;
    return { status, json: rpc };
  }
  return { status: 200, json: rpc };
}

export async function handleMcpHttp(input: McpHttpInput): Promise<McpHttpOutput> {
  const version = header(input.headers, 'MCP-Protocol-Version');
  const methodHeader = header(input.headers, 'Mcp-Method');
  const nameHeader = header(input.headers, 'Mcp-Name');
  const body = asObject(input.body);
  const rpcMethod = body.method;
  const rpcName = body.params?.name;

  if (version !== MCP_PROTOCOL_VERSION || methodHeader === undefined || nameHeader === undefined) {
    return {
      status: 400,
      json: {
        jsonrpc: '2.0',
        id: body.id ?? null,
        error: {
          code: MCP_ERROR_HEADER_MISMATCH,
          message: 'MCP-Protocol-Version, Mcp-Method, and Mcp-Name are required',
        },
      },
    };
  }

  if (methodHeader !== rpcMethod || nameHeader !== rpcName) {
    return {
      status: 400,
      json: {
        jsonrpc: '2.0',
        id: body.id ?? null,
        error: {
          code: MCP_ERROR_HEADER_MISMATCH,
          message: 'Header/body MCP method or name mismatch',
        },
      },
    };
  }

  const rpc = await input.app.runAsRequest(input.headers, () =>
    handleMcpRpc({ profile: input.profile, app: input.app, body: input.body }),
  );
  return rpcToHttp(rpc);
}
