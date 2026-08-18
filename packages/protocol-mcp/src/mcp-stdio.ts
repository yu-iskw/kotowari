import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import { isMcpProfile, type McpProfile } from './mcp-profiles.js';
import { createKotowariMcpServer } from './mcp-server.js';

import type { KotowariApp } from '@kotowari/application';
import type { Readable, Writable } from 'node:stream';

export function parseMcpProfileFlag(
  argv: readonly string[],
  fallback: McpProfile = 'retrieve',
): McpProfile {
  const flagIndex = argv.indexOf('--profile');
  const value = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  if (value !== undefined && isMcpProfile(value)) {
    return value;
  }
  return fallback;
}

export async function handleMcpStdio(input: {
  profile: McpProfile;
  app: KotowariApp;
  stdin: Readable;
  stdout: Writable;
  maxBufferSize?: number;
}): Promise<void> {
  const transport = new StdioServerTransport(input.stdin, input.stdout, {
    maxBufferSize: input.maxBufferSize ?? 10 * 1024 * 1024,
  });
  const handle = serveStdio(
    () => createKotowariMcpServer({ app: input.app, profile: input.profile }),
    { legacy: 'reject', transport },
  );

  await new Promise<void>((resolve, reject) => {
    input.stdin.once('end', resolve);
    input.stdin.once('error', reject);
  });
  await handle.close();
}
