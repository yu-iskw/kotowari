import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { toNodeHandler } from '@modelcontextprotocol/node';
import {
  createMcpHttpHandler,
  isMcpProfile,
  MCP_PROFILES,
  protectedResourceMetadata,
} from '@kotowari/protocol-mcp';
import { handleRest } from '@kotowari/protocol-rest';

import type { KotowariApp } from '@kotowari/application';
import type {
  McpAuditEvent,
  McpAuditSink,
  McpProfile,
  McpTokenVerifier,
} from '@kotowari/protocol-mcp';

class HttpRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type RateLimitOptions = {
  maxRequests: number;
  windowMs: number;
};

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

export type ServerMcpAuditEvent = McpAuditEvent & { traceId: string };

export type McpHttpSecurityOptions = {
  authorization?: {
    verifier: McpTokenVerifier;
    publicBaseUrl: string;
    authorizationServers: readonly string[];
  };
  maxBodyBytes?: number;
  requestTimeoutMs?: number;
  rateLimit?: RateLimitOptions;
  allowedHosts?: readonly string[];
  audit?: (event: ServerMcpAuditEvent) => void | Promise<void>;
};

function chunkToBuffer(chunk: unknown): Buffer {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk);
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  throw new TypeError('Unexpected HTTP chunk');
}

async function readBody(request: IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = chunkToBuffer(chunk);
    bytes += buffer.byteLength;
    if (bytes > maxBodyBytes) {
      throw new HttpRequestError(413, 'Request body too large');
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new HttpRequestError(400, 'Request body must be valid JSON');
  }
}

function headersOf(request: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    headers[key] = Array.isArray(value) ? value[0] : value;
  }
  return headers;
}

function mcpProfileFromPath(pathname: string): McpProfile | undefined {
  const suffix = pathname.replace(/^\/mcp\//u, '');
  return isMcpProfile(suffix) ? suffix : undefined;
}

function loadIndexHtml(webRoot: string | undefined): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const roots = [
    webRoot,
    join(here, '..', '..', 'web', 'public'),
    join(process.cwd(), 'apps', 'web', 'public'),
  ];
  for (const root of roots) {
    if (root === undefined) {
      continue;
    }
    try {
      return readFileSync(join(root, 'index.html'), 'utf8');
    } catch {
      continue;
    }
  }
  return '<!DOCTYPE html><title>Kotowari</title><p>Web UI not found.</p>';
}

function writeJson(response: ServerResponse, status: number, json: unknown, headers: Record<string, string> = {}): void {
  if (response.writableEnded) {
    return;
  }
  response.writeHead(status, { 'content-type': 'application/json', ...headers });
  response.end(JSON.stringify(json));
}

function publicMcpUrl(baseUrl: string, profile: McpProfile): URL {
  const url = new URL(baseUrl);
  url.pathname = `/mcp/${profile}`;
  url.search = '';
  url.hash = '';
  return url;
}

function hostnameOfHostHeader(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function hostIsAllowed(request: IncomingMessage, allowedHosts: readonly string[] | undefined): boolean {
  if (allowedHosts === undefined || allowedHosts.length === 0) {
    return true;
  }
  const hostname = hostnameOfHostHeader(request.headers.host);
  return hostname !== undefined && allowedHosts.some((allowed) => allowed.toLowerCase() === hostname);
}

function originIsAllowed(request: IncomingMessage, allowedHosts: readonly string[] | undefined): boolean {
  const origin = request.headers.origin;
  if (origin === undefined || allowedHosts === undefined || allowedHosts.length === 0) {
    return true;
  }
  try {
    const hostname = new URL(origin).hostname.toLowerCase();
    return allowedHosts.some((allowed) => allowed.toLowerCase() === hostname);
  } catch {
    return false;
  }
}

function rateLimitKey(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  const source = authorization ?? request.socket.remoteAddress ?? 'unknown';
  return createHash('sha256').update(source).digest('hex');
}

function createRateLimiter(options: RateLimitOptions | undefined): (request: IncomingMessage) => number | undefined {
  if (options === undefined) {
    return () => undefined;
  }
  const buckets = new Map<string, RateLimitBucket>();
  return (request) => {
    const now = Date.now();
    const key = rateLimitKey(request);
    const current = buckets.get(key);
    if (current === undefined || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return undefined;
    }
    current.count += 1;
    if (current.count <= options.maxRequests) {
      return undefined;
    }
    return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  };
}

export function listenKotowariHttp(options: {
  app: KotowariApp;
  port: number;
  host?: string;
  webRoot?: string;
  mcpSecurity?: McpHttpSecurityOptions;
}): Promise<{
  url: string;
  close: () => Promise<void>;
  app: KotowariApp;
}> {
  const indexHtml = loadIndexHtml(options.webRoot);
  const { app } = options;
  const host = options.host ?? '127.0.0.1';
  const maxBodyBytes = options.mcpSecurity?.maxBodyBytes ?? 4 * 1024 * 1024;
  const requestTimeoutMs = options.mcpSecurity?.requestTimeoutMs ?? 30_000;
  const consumeRateLimit = createRateLimiter(options.mcpSecurity?.rateLimit);
  const requestContext = new AsyncLocalStorage<{ traceId: string }>();

  const audit: McpAuditSink = async (event) => {
    const traceId = requestContext.getStore()?.traceId ?? 'unknown';
    const enriched = { ...event, traceId };
    if (options.mcpSecurity?.audit !== undefined) {
      await options.mcpSecurity.audit(enriched);
      return;
    }
    if (options.mcpSecurity?.authorization !== undefined) {
      process.stderr.write(`${JSON.stringify(enriched)}\n`);
    }
  };

  const handlers = new Map<
    McpProfile,
    {
      node: ReturnType<typeof toNodeHandler>;
      close: () => Promise<void>;
      metadataPath?: string;
      metadata?: Record<string, unknown>;
    }
  >();
  for (const profile of MCP_PROFILES) {
    const authorization = options.mcpSecurity?.authorization;
    const resourceServerUrl = authorization === undefined ? undefined : publicMcpUrl(authorization.publicBaseUrl, profile);
    const handler = createMcpHttpHandler({
      profile,
      app,
      audit,
      ...(authorization === undefined || resourceServerUrl === undefined
        ? {}
        : {
            authorization: {
              verifier: authorization.verifier,
              resourceServerUrl,
              authorizationServers: authorization.authorizationServers,
            },
          }),
    });
    handlers.set(profile, {
      node: toNodeHandler(handler),
      close: handler.close,
      ...(handler.resourceMetadataUrl === undefined || resourceServerUrl === undefined || authorization === undefined
        ? {}
        : {
            metadataPath: handler.resourceMetadataUrl.pathname,
            metadata: protectedResourceMetadata({
              profile,
              resourceServerUrl,
              authorizationServers: authorization.authorizationServers,
            }),
          }),
    });
  }

  const metadataRoutes = new Map<string, Record<string, unknown>>();
  for (const handler of handlers.values()) {
    if (handler.metadataPath !== undefined && handler.metadata !== undefined) {
      metadataRoutes.set(handler.metadataPath, handler.metadata);
    }
  }

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      try {
        const hostHeader = request.headers.host ?? '127.0.0.1';
        const url = new URL(request.url ?? '/', `http://${hostHeader}`);
        const metadata = metadataRoutes.get(url.pathname);
        if (metadata !== undefined) {
          if (request.method !== 'GET') {
            writeJson(response, 405, { error: 'method_not_allowed' }, { allow: 'GET' });
            return;
          }
          writeJson(response, 200, metadata, { 'access-control-allow-origin': '*' });
          return;
        }

        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end(indexHtml);
          return;
        }

        const profile = url.pathname.startsWith('/mcp/') ? mcpProfileFromPath(url.pathname) : undefined;
        if (profile !== undefined) {
          if (!hostIsAllowed(request, options.mcpSecurity?.allowedHosts) || !originIsAllowed(request, options.mcpSecurity?.allowedHosts)) {
            writeJson(response, 403, { error: 'forbidden_host_or_origin' });
            return;
          }
          const retryAfter = consumeRateLimit(request);
          if (retryAfter !== undefined) {
            writeJson(response, 429, { error: 'rate_limited' }, { 'retry-after': String(retryAfter) });
            return;
          }

          const traceId =
            typeof request.headers['x-request-id'] === 'string'
              ? request.headers['x-request-id']
              : randomUUID();
          response.setHeader('x-request-id', traceId);
          const body = request.method === 'GET' || request.method === 'HEAD' ? undefined : await readBody(request, maxBodyBytes);
          const selected = handlers.get(profile);
          if (selected === undefined) {
            throw new Error(`MCP profile ${profile} is not configured`);
          }

          let timedOut = false;
          const timeout = setTimeout(() => {
            timedOut = true;
            if (!response.writableEnded) {
              if (!response.headersSent) {
                writeJson(response, 504, { error: 'mcp_request_timeout' });
              } else {
                response.destroy();
              }
            }
          }, requestTimeoutMs);
          try {
            await requestContext.run({ traceId }, () => selected.node(request, response, body));
          } catch (error) {
            if (!timedOut) {
              throw error;
            }
          } finally {
            clearTimeout(timeout);
          }
          return;
        }

        const body =
          request.method === 'POST'
            ? await readBody(request, maxBodyBytes)
            : Object.fromEntries(url.searchParams.entries());
        const result = await handleRest(app, {
          method: request.method ?? 'GET',
          pathname: url.pathname,
          body,
          headers: headersOf(request),
        });
        writeJson(response, result.status, result.json);
      } catch (error) {
        if (error instanceof HttpRequestError) {
          writeJson(response, error.status, { error: error.message });
          return;
        }
        writeJson(response, 500, { error: 'internal error' });
      }
    })();
  });

  return new Promise((resolve) => {
    server.listen(options.port, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      const displayHost = host === '0.0.0.0' ? '127.0.0.1' : host;
      resolve({
        url: `http://${displayHost}:${String(port)}`,
        app,
        close: async () => {
          await Promise.all([...handlers.values()].map((handler) => handler.close()));
          await new Promise<void>((closeResolve, closeReject) => {
            server.close((err) => {
              if (err) {
                closeReject(err);
                return;
              }
              closeResolve();
            });
          });
        },
      });
    });
  });
}
