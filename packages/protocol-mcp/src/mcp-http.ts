import { dispatchIngest } from '@kotowari/application';

import type { KotowariApp } from '@kotowari/application';

export const MCP_PROTOCOL_VERSION = '2026-07-28';
export const MCP_ERROR_HEADER_MISMATCH = -32020;

export type McpProfile = 'retrieve' | 'knowledge' | 'memory' | 'ingestion' | 'admin';

export const PROFILE_TOOLS: Record<McpProfile, readonly string[]> = {
  retrieve: ['search_knowledge', 'search_memory', 'record_decision'],
  knowledge: ['search_knowledge', 'record_decision', 'resolve_conflict'],
  memory: ['search_memory', 'record_memory'],
  ingestion: ['ingest_path'],
  admin: ['list_policies', 'what_if_policy', 'export_prov'],
};

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

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

type ToolHandler = (app: KotowariApp, args: Record<string, unknown>) => Promise<unknown>;

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) {
      return value;
    }
  }
  return undefined;
}

function asObject(value: unknown): JsonRpcRequest {
  if (value !== null && typeof value === 'object') {
    return value;
  }
  return {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' ? value : fallback;
}

function asClaimIds(value: unknown): [string, string, ...string[]] {
  if (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every((item) => typeof item === 'string')
  ) {
    return value as [string, string, ...string[]];
  }
  return ['', ''];
}

function unknownMethodLabel(rpcMethod: string | undefined): string {
  return rpcMethod === undefined ? '(missing)' : rpcMethod;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function ingestFromToolArgs(
  app: KotowariApp,
  args: Record<string, unknown>,
): Promise<unknown> {
  const dispatched = await dispatchIngest(app, args);
  if (!dispatched.ok) {
    return { error: dispatched.error };
  }
  return dispatched.result;
}

async function runWhatIfPolicy(app: KotowariApp, args: Record<string, unknown>): Promise<unknown> {
  const policy = args['policy'];
  if (!isRecord(policy) || typeof policy['id'] !== 'string' || typeof policy['name'] !== 'string') {
    return { results: [], error: 'policy required' };
  }
  return app.whatIfPolicy(policy as Parameters<KotowariApp['whatIfPolicy']>[0]);
}

const TOOL_HANDLERS = new Map<string, ToolHandler>([
  [
    'search_knowledge',
    async (app, args) =>
      app.searchKnowledge({
        query: asString(args['query']),
        purpose: args['purpose'] === undefined ? undefined : asString(args['purpose']),
      }),
  ],
  ['search_memory', async (app, args) => app.searchMemory({ query: asString(args['query']) })],
  ['record_memory', async (app, args) => app.recordMemory({ body: asString(args['body']) })],
  [
    'record_decision',
    async (app, args) =>
      app.recordDecision({
        purpose: asString(args['purpose'], 'general'),
        query: args['query'] === undefined ? undefined : asString(args['query']),
        selectedOutcome: asString(args['selectedOutcome']),
        confidence: asNumber(args['confidence'], 0.5),
        rationale: args['rationale'] === undefined ? undefined : asString(args['rationale']),
      }),
  ],
  ['ingest_path', async (app, args) => ingestFromToolArgs(app, args)],
  [
    'resolve_conflict',
    async (app, args) =>
      app.resolveConflict({
        claimIds: asClaimIds(args['claimIds']),
        preferredClaimId: asString(args['preferredClaimId']),
        reason: asString(args['reason']),
      }),
  ],
  ['export_prov', async (app, args) => app.exportProvO(asString(args['decisionId']))],
  ['list_policies', async (app) => ({ policies: await app.listPolicies() })],
  ['what_if_policy', async (app, args) => runWhatIfPolicy(app, args)],
]);

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

  if (rpcMethod === 'tools/list') {
    return {
      status: 200,
      json: {
        jsonrpc: '2.0',
        id: body.id ?? null,
        result: {
          tools: PROFILE_TOOLS[input.profile].map((name) => ({ name })),
        },
      },
    };
  }

  if (rpcMethod === 'tools/call') {
    const allowed = PROFILE_TOOLS[input.profile];
    if (!allowed.includes(rpcName)) {
      return {
        status: 403,
        json: {
          jsonrpc: '2.0',
          id: body.id ?? null,
          error: { code: -32001, message: `Tool ${rpcName} is not on ${input.profile} profile` },
        },
      };
    }
    const args = body.params?.arguments === undefined ? {} : body.params.arguments;
    const result = await dispatchTool(input.app, rpcName, args);
    return {
      status: 200,
      json: { jsonrpc: '2.0', id: body.id ?? null, result },
    };
  }

  return {
    status: 400,
    json: {
      jsonrpc: '2.0',
      id: body.id ?? null,
      error: { code: -32601, message: `Unknown method ${unknownMethodLabel(rpcMethod)}` },
    },
  };
}

async function dispatchTool(
  app: KotowariApp,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const handler = TOOL_HANDLERS.get(name);
  if (handler === undefined) {
    return { error: `unknown tool ${name}` };
  }
  return handler(app, args);
}

export function spyApplicationCommandName(toolName: string): string {
  switch (toolName) {
    case 'search_knowledge':
      return 'searchKnowledge';
    case 'search_memory':
      return 'searchMemory';
    case 'record_decision':
      return 'recordDecision';
    case 'record_memory':
      return 'recordMemory';
    case 'ingest_path':
      return 'ingestPath';
    case 'resolve_conflict':
      return 'resolveConflict';
    case 'export_prov':
      return 'exportProvO';
    case 'list_policies':
      return 'listPolicies';
    case 'what_if_policy':
      return 'whatIfPolicy';
    default:
      return toolName;
  }
}
