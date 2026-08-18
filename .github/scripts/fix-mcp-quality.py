from pathlib import Path
from textwrap import dedent


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    if old not in text:
        raise SystemExit(f"expected block not found in {path}")
    target.write_text(text.replace(old, new, 1))


replace(
    "packages/adapter-fs/src/oauth-introspection-identity-provider.ts",
    "    if (payload['active'] !== true) {\n",
    "    // The OAuth introspection `active` flag is public metadata, not secret material.\n"
    "    // eslint-disable-next-line security/detect-possible-timing-attacks\n"
    "    if (payload['active'] !== true) {\n",
)

replace(
    "packages/protocol-mcp/src/mcp-http.ts",
    "import type { AuthInfo } from '@modelcontextprotocol/server';\n"
    "import type { KotowariApp } from '@kotowari/application';\n",
    "import type { KotowariApp } from '@kotowari/application';\n"
    "import type { AuthInfo } from '@modelcontextprotocol/server';\n",
)
replace(
    "packages/protocol-mcp/src/mcp-http.ts",
    "        return (await verifier.verifyAccessToken(token)) as AuthInfo;\n",
    "        return verifier.verifyAccessToken(token);\n",
)

replace(
    "packages/protocol-mcp/src/mcp-server.ts",
    "function resultText(tool: string, output: unknown): string {\n"
    "  const serialized = JSON.stringify(output);\n"
    "  if (serialized === undefined) {\n"
    "    return `${tool} completed`;\n"
    "  }\n"
    "  const maxChars = 8_000;\n",
    "function resultText(output: unknown): string {\n"
    "  const serialized = JSON.stringify(output);\n"
    "  const maxChars = 8_000;\n",
)
replace(
    "packages/protocol-mcp/src/mcp-server.ts",
    "text: resultText(operation.name, output)",
    "text: resultText(output)",
)

replace(
    "packages/protocol-mcp/src/operation-registry.ts",
    "const genericObjectOutput = z.object({}).passthrough();\n"
    "const decisionIdInput = z.object({ decisionId: z.string().min(1) }).strict();\n",
    "const genericObjectOutput = z.object({}).passthrough();\n"
    "const decisionIdInput = z.object({ decisionId: z.string().min(1) }).strict();\n"
    "const DECISION_NOT_FOUND = 'Decision not found';\n",
)
operation_registry = Path("packages/protocol-mcp/src/operation-registry.ts")
operation_registry.write_text(
    operation_registry.read_text().replace(
        "throw new Error('Decision not found');",
        "throw new Error(DECISION_NOT_FOUND);",
    )
)

replace(
    "packages/protocol-mcp/src/tool-schemas.test.ts",
    "function embeddedInputSchema(schema: z.ZodType): Record<string, unknown> {\n"
    "  const generated = z.toJSONSchema(schema, { io: 'input' });\n"
    "  const { $schema: _schemaDeclaration, ...embedded } = generated;\n"
    "  return embedded;\n"
    "}\n",
    "function embeddedInputSchema(schema: z.ZodType): Record<string, unknown> {\n"
    "  const embedded: Record<string, unknown> = {\n"
    "    ...z.toJSONSchema(schema, { io: 'input' }),\n"
    "  };\n"
    "  delete embedded['$schema'];\n"
    "  return embedded;\n"
    "}\n",
)
replace(
    "packages/protocol-mcp/src/tool-schemas.test.ts",
    "      expect(tool.description).toBe(operation?.description);\n"
    "      expect(tool.inputSchema).toEqual(\n"
    "        embeddedInputSchema(operation?.inputSchema ?? z.never()),\n"
    "      );\n",
    "      expect(tool.description).toBe(operation.description);\n"
    "      expect(tool.inputSchema).toEqual(embeddedInputSchema(operation.inputSchema));\n",
)

replace(
    "packages/application/src/create-app.ts",
    "}\n\nexport type KotowariPorts = {\n",
    "}\n\n"
    "function assertDecisionAllowed(\n"
    "  principal: Principal,\n"
    "  action: 'decision.read' | 'audit.read',\n"
    "  decision: Decision,\n"
    "): void {\n"
    "  assertAllowed(\n"
    "    principal,\n"
    "    action,\n"
    "    { kind: 'decision', id: decision.id, metadata: decision },\n"
    "    { tenantId: principal.tenantId },\n"
    "  );\n"
    "}\n\n"
    "export type KotowariPorts = {\n",
)
replace(
    "packages/application/src/create-app.ts",
    "      assertAllowed(\n"
    "        actor,\n"
    "        'decision.read',\n"
    "        { kind: 'decision', id: decision.id, metadata: decision },\n"
    "        { tenantId: actor.tenantId },\n"
    "      );\n",
    "      assertDecisionAllowed(actor, 'decision.read', decision);\n",
)
replace(
    "packages/application/src/create-app.ts",
    "      assertAllowed(\n"
    "        actor,\n"
    "        'audit.read',\n"
    "        { kind: 'decision', id: decision.id, metadata: decision },\n"
    "        { tenantId: actor.tenantId },\n"
    "      );\n",
    "      assertDecisionAllowed(actor, 'audit.read', decision);\n",
)

http_path = Path("apps/server/src/http-server.ts")
http = http_path.read_text()
http = http.replace(
    "import { toNodeHandler } from '@modelcontextprotocol/node';\nimport {\n",
    "import {\n",
    1,
)
http = http.replace(
    "import { handleRest } from '@kotowari/protocol-rest';\n\nimport type",
    "import { handleRest } from '@kotowari/protocol-rest';\n"
    "import { toNodeHandler } from '@modelcontextprotocol/node';\n\nimport type",
    1,
)

marker = "export function listenKotowariHttp(options: {\n"
helpers = dedent(
    """
    type McpRuntimeHandler = {
      node: ReturnType<typeof toNodeHandler>;
      close: () => Promise<void>;
      metadataPath?: string;
      metadata?: Record<string, unknown>;
    };

    type RequestRouterInput = {
      app: KotowariApp;
      indexHtml: string;
      handlers: ReadonlyMap<McpProfile, McpRuntimeHandler>;
      metadataRoutes: ReadonlyMap<string, Record<string, unknown>>;
      maxBodyBytes: number;
      requestTimeoutMs: number;
      consumeRateLimit: (request: IncomingMessage) => number | undefined;
      requestContext: AsyncLocalStorage<{ traceId: string }>;
      allowedHosts?: readonly string[];
    };

    function incomingUrl(request: IncomingMessage): URL {
      const hostHeader = request.headers.host ?? '127.0.0.1';
      return new URL(request.url ?? '/', `http://${hostHeader}`);
    }

    function handleMetadataRoute(
      request: IncomingMessage,
      response: ServerResponse,
      metadata: Record<string, unknown> | undefined,
    ): boolean {
      if (metadata === undefined) {
        return false;
      }
      if (request.method !== 'GET') {
        writeJson(response, 405, { error: 'method_not_allowed' }, { allow: 'GET' });
        return true;
      }
      writeJson(response, 200, metadata, { 'access-control-allow-origin': '*' });
      return true;
    }

    function handleIndexRoute(
      request: IncomingMessage,
      response: ServerResponse,
      url: URL,
      indexHtml: string,
    ): boolean {
      if (
        request.method !== 'GET' ||
        (url.pathname !== '/' && url.pathname !== '/index.html')
      ) {
        return false;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(indexHtml);
      return true;
    }

    async function runMcpWithTimeout(input: {
      request: IncomingMessage;
      response: ServerResponse;
      body: unknown;
      handler: McpRuntimeHandler;
      traceId: string;
      requestTimeoutMs: number;
      requestContext: AsyncLocalStorage<{ traceId: string }>;
    }): Promise<void> {
      const timeout = setTimeout(() => {
        if (input.response.writableEnded) {
          return;
        }
        if (!input.response.headersSent) {
          writeJson(input.response, 504, { error: 'mcp_request_timeout' });
          return;
        }
        input.response.destroy();
      }, input.requestTimeoutMs);
      try {
        await input.requestContext.run({ traceId: input.traceId }, () =>
          input.handler.node(input.request, input.response, input.body),
        );
      } finally {
        clearTimeout(timeout);
      }
    }

    async function handleMcpRoute(
      input: RequestRouterInput,
      request: IncomingMessage,
      response: ServerResponse,
      url: URL,
    ): Promise<boolean> {
      const profile = url.pathname.startsWith('/mcp/')
        ? mcpProfileFromPath(url.pathname)
        : undefined;
      if (profile === undefined) {
        return false;
      }
      if (
        !hostIsAllowed(request, input.allowedHosts) ||
        !originIsAllowed(request, input.allowedHosts)
      ) {
        writeJson(response, 403, { error: 'forbidden_host_or_origin' });
        return true;
      }
      const retryAfter = input.consumeRateLimit(request);
      if (retryAfter !== undefined) {
        writeJson(response, 429, { error: 'rate_limited' }, { 'retry-after': String(retryAfter) });
        return true;
      }
      const traceId =
        typeof request.headers['x-request-id'] === 'string'
          ? request.headers['x-request-id']
          : randomUUID();
      response.setHeader('x-request-id', traceId);
      const body =
        request.method === 'GET' || request.method === 'HEAD'
          ? undefined
          : await readBody(request, input.maxBodyBytes);
      const handler = input.handlers.get(profile);
      if (handler === undefined) {
        throw new Error(`MCP profile ${profile} is not configured`);
      }
      await runMcpWithTimeout({
        request,
        response,
        body,
        handler,
        traceId,
        requestTimeoutMs: input.requestTimeoutMs,
        requestContext: input.requestContext,
      });
      return true;
    }

    async function handleRestRoute(
      input: RequestRouterInput,
      request: IncomingMessage,
      response: ServerResponse,
      url: URL,
    ): Promise<void> {
      const body =
        request.method === 'POST'
          ? await readBody(request, input.maxBodyBytes)
          : Object.fromEntries(url.searchParams.entries());
      const result = await handleRest(input.app, {
        method: request.method ?? 'GET',
        pathname: url.pathname,
        body,
        headers: headersOf(request),
      });
      writeJson(response, result.status, result.json);
    }

    async function routeRequest(
      input: RequestRouterInput,
      request: IncomingMessage,
      response: ServerResponse,
    ): Promise<void> {
      const url = incomingUrl(request);
      if (handleMetadataRoute(request, response, input.metadataRoutes.get(url.pathname))) {
        return;
      }
      if (handleIndexRoute(request, response, url, input.indexHtml)) {
        return;
      }
      if (await handleMcpRoute(input, request, response, url)) {
        return;
      }
      await handleRestRoute(input, request, response, url);
    }

    function writeRequestError(response: ServerResponse, error: unknown): void {
      if (error instanceof HttpRequestError) {
        writeJson(response, error.status, { error: error.message });
        return;
      }
      writeJson(response, 500, { error: 'internal error' });
    }

    """
)
if marker not in http:
    raise SystemExit("listen marker not found in http-server.ts")
http = http.replace(marker, helpers + marker, 1)

old_map = dedent(
    """
      const handlers = new Map<
        McpProfile,
        {
          node: ReturnType<typeof toNodeHandler>;
          close: () => Promise<void>;
          metadataPath?: string;
          metadata?: Record<string, unknown>;
        }
      >();
    """
).strip("\n")
if old_map not in http:
    raise SystemExit("handler map block not found in http-server.ts")
http = http.replace(old_map, "  const handlers = new Map<McpProfile, McpRuntimeHandler>();", 1)

start = http.index(
    "  const server = createServer((request: IncomingMessage, response: ServerResponse) => {"
)
end = http.index("\n\n  return new Promise((resolve) => {", start)
new_server = dedent(
    """
      const router: RequestRouterInput = {
        app,
        indexHtml,
        handlers,
        metadataRoutes,
        maxBodyBytes,
        requestTimeoutMs,
        consumeRateLimit,
        requestContext,
        ...(options.mcpSecurity?.allowedHosts === undefined
          ? {}
          : { allowedHosts: options.mcpSecurity.allowedHosts }),
      };
      const server = createServer((request: IncomingMessage, response: ServerResponse) => {
        void routeRequest(router, request, response).catch((error: unknown) => {
          writeRequestError(response, error);
        });
      });
    """
).strip("\n")
http_path.write_text(http[:start] + new_server + http[end:])
