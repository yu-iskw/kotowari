import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createEmbeddedQueue,
  createFileBlobStore,
  createLocalIdentityProvider,
} from '@kotowari/adapter-fs';
import { createSqliteCanonicalStore } from '@kotowari/adapter-sqlite';
import { createKotowariApp } from '@kotowari/application';
import { createFakeEmbeddingProvider, createFakeExtractionProvider } from '@kotowari/model-fake';
import { handleMcpStdio, parseMcpProfileFlag } from '@kotowari/protocol-mcp';

import { listenKotowariHttp } from './http-server.js';
import { ingestFilesystemPath } from './ingest-fs.js';

import type { KotowariApp } from '@kotowari/application';
import type { Readable, Writable } from 'node:stream';

export type StandaloneOptions = {
  dataDir: string;
  webRoot?: string;
};

export { ingestFilesystemPath } from './ingest-fs.js';

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
  const app: KotowariApp = {
    ...core,
    ingestPath: async (target: string) => ingestFilesystemPath(app, target),
  };
  return app;
}

export function startKotowariServer(options: StandaloneOptions & { port: number }): Promise<{
  url: string;
  close: () => Promise<void>;
  app: KotowariApp;
}> {
  return listenKotowariHttp({
    app: createStandaloneApp(options),
    port: options.port,
    webRoot: options.webRoot,
  });
}

export async function runKotowariMcpStdio(input: {
  argv: readonly string[];
  dataDir: string;
  stdin?: Readable;
  stdout?: Writable;
}): Promise<void> {
  const profile = parseMcpProfileFlag(input.argv);
  const app = createStandaloneApp({ dataDir: input.dataDir });
  await handleMcpStdio({
    profile,
    app,
    stdin: input.stdin ?? process.stdin,
    stdout: input.stdout ?? process.stdout,
  });
}

export function writeWorkspaceConfig(directory: string, port: number): void {
  mkdirSync(join(directory, '.kotowari'), { recursive: true });
  writeFileSync(
    join(directory, '.kotowari', 'kotowari.json'),
    `${JSON.stringify({ profile: 'standalone', port, dataDir: '.kotowari' }, null, 2)}\n`,
  );
}
