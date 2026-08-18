import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';

import {
  DEFAULT_MCP_STANDALONE_PRESET,
  isMcpStandalonePreset,
  type McpStandalonePreset,
} from './mcp-presets.js';
import { createKotowariMcpServer } from './mcp-server.js';

import type { KotowariApp } from '@kotowari/application';
import type { McpOperationName } from './operation-registry.js';
import type { Readable, Writable } from 'node:stream';

export function parseMcpStandalonePresetFlag(
  argv: readonly string[],
  fallback: McpStandalonePreset = DEFAULT_MCP_STANDALONE_PRESET,
): McpStandalonePreset {
  const flagIndex = argv.indexOf('--preset');
  const value = flagIndex >= 0 ? argv[flagIndex + 1] : undefined;
  if (value === undefined) {
    return fallback;
  }
  if (!isMcpStandalonePreset(value)) {
    throw new Error(`Unknown MCP standalone preset: ${value}`);
  }
  return value;
}

export async function handleMcpStdio(input: {
  name: string;
  operations: readonly McpOperationName[];
  app: KotowariApp;
  stdin: Readable;
  stdout: Writable;
  maxBufferSize?: number;
}): Promise<void> {
  const transport = new StdioServerTransport(input.stdin, input.stdout, {
    maxBufferSize: input.maxBufferSize ?? 10 * 1024 * 1024,
  });
  const handle = serveStdio(
    () =>
      createKotowariMcpServer({
        app: input.app,
        name: input.name,
        operations: input.operations,
      }),
    { legacy: 'reject', transport },
  );

  await new Promise<void>((resolve, reject) => {
    input.stdin.once('end', resolve);
    input.stdin.once('error', reject);
  });
  await handle.close();
}
