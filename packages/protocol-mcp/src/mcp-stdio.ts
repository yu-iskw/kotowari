import { createInterface } from 'node:readline';

import { isMcpProfile, type McpProfile } from './mcp-profiles.js';
import { handleMcpRpc } from './mcp-rpc.js';

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
}): Promise<void> {
  const lines = createInterface({ input: input.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    let body: unknown;
    try {
      body = JSON.parse(trimmed) as unknown;
    } catch {
      input.stdout.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        })}\n`,
      );
      continue;
    }
    const record = body as { method?: string; id?: unknown };
    if (
      typeof record.method === 'string' &&
      record.method.startsWith('notifications/') &&
      record.id === undefined
    ) {
      continue;
    }
    const rpc = await handleMcpRpc({ profile: input.profile, app: input.app, body });
    input.stdout.write(`${JSON.stringify(rpc)}\n`);
  }
}
