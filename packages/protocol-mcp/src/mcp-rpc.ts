import {
  ApplicationError,
  dispatchIngest,
  requireClaimIds,
  type KotowariApp,
} from '@kotowari/application';

import { PROFILE_TOOLS, type McpProfile } from './mcp-profiles.js';
import { toolDescriptor } from './tool-schemas.js';

export const MCP_PROTOCOL_VERSION = '2026-07-28';

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: {
    name?: string;
    arguments?: Record<string, unknown>;
  };
};

export type McpRpcResult = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

type ToolHandler = (app: KotowariApp, args: Record<string, unknown>) => Promise<unknown>;

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
  [
    'search_decisions',
    async (app, args) => app.searchDecisions({ query: asString(args['query']) }),
  ],
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
        claimIds: requireClaimIds(args['claimIds']),
        preferredClaimId: asString(args['preferredClaimId']),
        reason: asString(args['reason']),
      }),
  ],
  ['export_prov', async (app, args) => app.exportProvO(asString(args['decisionId']))],
  ['list_policies', async (app) => ({ policies: await app.listPolicies() })],
  ['what_if_policy', async (app, args) => runWhatIfPolicy(app, args)],
]);

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

function rpcErrorFromApplication(error: ApplicationError): { code: number; message: string } {
  const code = error.status === 401 ? -32002 : error.status === 403 ? -32003 : -32602;
  return { code, message: error.message };
}

async function callAllowedTool(input: {
  app: KotowariApp;
  id: string | number | null;
  rpcName: string;
  args: Record<string, unknown>;
}): Promise<McpRpcResult> {
  try {
    const result = await dispatchTool(input.app, input.rpcName, input.args);
    return { jsonrpc: '2.0', id: input.id, result };
  } catch (error) {
    if (error instanceof ApplicationError) {
      return { jsonrpc: '2.0', id: input.id, error: rpcErrorFromApplication(error) };
    }
    throw error;
  }
}

export function spyApplicationCommandName(toolName: string): string {
  switch (toolName) {
    case 'search_knowledge':
      return 'searchKnowledge';
    case 'search_memory':
      return 'searchMemory';
    case 'search_decisions':
      return 'searchDecisions';
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

export async function handleMcpRpc(input: {
  profile: McpProfile;
  app: KotowariApp;
  body: unknown;
}): Promise<McpRpcResult> {
  const body = asObject(input.body);
  const id = body.id ?? null;
  const rpcMethod = body.method;
  const rpcName = body.params?.name;

  if (rpcMethod === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'kotowari', version: '0.1.0' },
      },
    };
  }

  if (rpcMethod === 'notifications/initialized' || rpcMethod === 'initialized') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (rpcMethod === 'ping') {
    return { jsonrpc: '2.0', id, result: {} };
  }

  if (rpcMethod === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: PROFILE_TOOLS[input.profile].map((name) => toolDescriptor(name)),
      },
    };
  }

  if (rpcMethod === 'tools/call') {
    const allowed = PROFILE_TOOLS[input.profile];
    if (rpcName === undefined || !allowed.includes(rpcName)) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32001,
          message: `Tool ${rpcName ?? '(missing)'} is not on ${input.profile} profile`,
        },
      };
    }
    const args = body.params?.arguments === undefined ? {} : body.params.arguments;
    return callAllowedTool({ app: input.app, id, rpcName, args });
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `Unknown method ${unknownMethodLabel(rpcMethod)}` },
  };
}
