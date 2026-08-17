import { createServer } from 'node:http';

import { AdapterS3Error } from './errors.js';

import type { IncomingMessage, Server, ServerResponse } from 'node:http';

const DEFAULT_CONTENT_TYPE = 'application/octet-stream';
const LISTEN_HOST = '127.0.0.1';

type StoredObject = {
  bytes: Buffer;
  contentType: string;
};

function requestPathname(request: IncomingMessage): string {
  const pathWithQuery = request.url ?? '/';
  return pathWithQuery.split('?')[0] ?? '/';
}

function headerString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  return undefined;
}

function requestContentType(request: IncomingMessage): string {
  const value = headerString(request.headers['content-type']);
  if (value !== undefined && value.length > 0) {
    return value;
  }
  return DEFAULT_CONTENT_TYPE;
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

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunkToBuffer(chunk));
  }
  return Buffer.concat(chunks);
}

async function handleRequest(
  storage: Map<string, StoredObject>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const pathname = requestPathname(request);
  if (request.method === 'PUT') {
    const bytes = await readBody(request);
    storage.set(pathname, { bytes, contentType: requestContentType(request) });
    response.writeHead(200);
    response.end();
    return;
  }
  if (request.method === 'GET') {
    const object = storage.get(pathname);
    if (object === undefined) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': object.contentType });
    response.end(object.bytes);
    return;
  }
  response.writeHead(405);
  response.end();
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function listenOnEphemeralPort(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once('error', onError);
    server.listen(0, LISTEN_HOST, () => {
      server.off('error', onError);
      const address = server.address();
      if (address === null || typeof address === 'string') {
        reject(new AdapterS3Error('In-process S3 server has no TCP address'));
        return;
      }
      resolve(address.port);
    });
  });
}

export async function startInProcessS3(): Promise<{
  endpoint: string;
  close: () => Promise<void>;
}> {
  const storage = new Map<string, StoredObject>();
  const server = createServer((request, response) => {
    void handleRequest(storage, request, response).catch(() => {
      if (!response.headersSent) {
        response.writeHead(500);
      }
      response.end();
    });
  });
  const port = await listenOnEphemeralPort(server);
  return {
    endpoint: `http://${LISTEN_HOST}:${String(port)}`,
    close: () => closeServer(server),
  };
}
