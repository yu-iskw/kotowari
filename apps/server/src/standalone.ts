import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { basename, dirname, join, relative, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createEmbeddedQueue,
  createFileBlobStore,
  createLocalIdentityProvider,
} from '@kotowari/adapter-fs';
import { createSqliteCanonicalStore } from '@kotowari/adapter-sqlite';
import { createKotowariApp } from '@kotowari/application';
import { documentMimeType } from '@kotowari/capability-ingestion';
import { createFakeEmbeddingProvider, createFakeExtractionProvider } from '@kotowari/model-fake';
import { handleMcpHttp, PROFILE_TOOLS } from '@kotowari/protocol-mcp';
import { handleRest } from '@kotowari/protocol-rest';

import type { KotowariApp } from '@kotowari/application';
import type { IngestResult } from '@kotowari/capability-ingestion';
import type { McpProfile } from '@kotowari/protocol-mcp';

export type StandaloneOptions = {
  dataDir: string;
  webRoot?: string;
};

export function createStandaloneApp(options: StandaloneOptions): KotowariApp {
  mkdirSync(options.dataDir, { recursive: true });
  const core = createKotowariApp({
    store: createSqliteCanonicalStore(join(options.dataDir, 'canonical.sqlite')),
    blobs: createFileBlobStore(join(options.dataDir, 'blobs')),
    identity: createLocalIdentityProvider(),
    queue: createEmbeddedQueue(),
    extraction: createFakeExtractionProvider(),
    embeddings: createFakeEmbeddingProvider(),
  });
  return {
    ...core,
    ingestPath: async (target: string) => ingestFilesystemPath(core, target),
  };
}

function collectFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.kotowari') {
        continue;
      }
      files.push(...collectFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

export async function ingestFilesystemPath(
  app: KotowariApp,
  target: string,
): Promise<IngestResult> {
  const resolved = resolvePath(target);
  const stats = statSync(resolved);
  const files = stats.isDirectory() ? collectFiles(resolved) : [resolved];
  const documents = files.map((file) => ({
    relativePath: stats.isDirectory() ? relative(resolved, file) : basename(file),
    bytes: new Uint8Array(readFileSync(file)),
    mimeType: documentMimeType(file),
  }));
  return app.ingestDocuments(documents);
}

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

export function startKotowariServer(options: StandaloneOptions & { port: number }): Promise<{
  url: string;
  close: () => Promise<void>;
  app: KotowariApp;
}> {
  const app = createStandaloneApp(options);
  const indexHtml = loadIndexHtml(options.webRoot);

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

export function writeWorkspaceConfig(directory: string, port: number): void {
  mkdirSync(join(directory, '.kotowari'), { recursive: true });
  writeFileSync(
    join(directory, '.kotowari', 'kotowari.json'),
    `${JSON.stringify({ profile: 'standalone', port, dataDir: '.kotowari' }, null, 2)}\n`,
  );
}
