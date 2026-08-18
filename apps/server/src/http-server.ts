import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { handleMcpHttp, PROFILE_TOOLS } from '@kotowari/protocol-mcp';
import { handleRest } from '@kotowari/protocol-rest';

import type { KotowariApp } from '@kotowari/application';
import type { McpProfile } from '@kotowari/protocol-mcp';

function chunkToBuffer(chunk: unknown): Buffer {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk);
  }
  if (chunk instanceof Uint8Array) {
    return Buffer.from(chunk);
  }
  throw new TypeError('Unexpected HTTP chunk');
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunkToBuffer(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.length === 0) {
    return undefined;
  }
  return JSON.parse(raw) as unknown;
}

function headersOf(request: IncomingMessage): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(request.headers)) {
    headers[key] = Array.isArray(value) ? value[0] : value;
  }
  return headers;
}

function isMcpProfile(value: string): value is McpProfile {
  return Object.hasOwn(PROFILE_TOOLS, value);
}

function mcpProfileFromPath(pathname: string): McpProfile | undefined {
  const suffix = pathname.replace(/^\/mcp\//, '');
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

export function listenKotowariHttp(options: {
  app: KotowariApp;
  port: number;
  webRoot?: string;
}): Promise<{
  url: string;
  close: () => Promise<void>;
  app: KotowariApp;
}> {
  const indexHtml = loadIndexHtml(options.webRoot);
  const { app } = options;

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      try {
        const host = request.headers.host ?? '127.0.0.1';
        const url = new URL(request.url ?? '/', `http://${host}`);
        if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end(indexHtml);
          return;
        }
        const profile = url.pathname.startsWith('/mcp/')
          ? mcpProfileFromPath(url.pathname)
          : undefined;
        if (profile !== undefined && request.method === 'POST') {
          const body = await readBody(request);
          const result = await handleMcpHttp({
            profile,
            headers: headersOf(request),
            body,
            app,
          });
          response.writeHead(result.status, { 'content-type': 'application/json' });
          response.end(JSON.stringify(result.json));
          return;
        }
        const body =
          request.method === 'POST'
            ? await readBody(request)
            : Object.fromEntries(url.searchParams.entries());
        const result = await handleRest(app, {
          method: request.method ?? 'GET',
          pathname: url.pathname,
          body,
          headers: headersOf(request),
        });
        response.writeHead(result.status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(result.json));
      } catch (error) {
        response.writeHead(500, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ error: error instanceof Error ? error.message : 'internal error' }),
        );
      }
    })();
  });

  return new Promise((resolve) => {
    server.listen(options.port, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : options.port;
      resolve({
        url: `http://127.0.0.1:${String(port)}`,
        app,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((err) => {
              if (err) {
                closeReject(err);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}
