import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export type CursorPluginManifest = {
  name: string;
  displayName?: string;
  version?: string;
  description?: string;
  skills?: string;
  mcpServers?: Record<
    string,
    {
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  >;
};

export type McpToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolsDocument = {
  tools: McpToolDescriptor[];
};

function readJson<T>(absolutePath: string): T {
  const raw = readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw) as T;
}

export const cursorPluginManifest: CursorPluginManifest = readJson(
  join(packageRoot, '.cursor-plugin/plugin.json'),
);

export const retrieveToolsDocument: McpToolsDocument = readJson(
  join(packageRoot, 'src/generated/tools.json'),
);

export const decisionToolsDocument: McpToolsDocument = readJson(
  join(packageRoot, 'src/generated/decision-tools.json'),
);

export const retrieveToolNames: readonly string[] = retrieveToolsDocument.tools.map(
  (tool) => tool.name,
);

export const decisionToolNames: readonly string[] = decisionToolsDocument.tools.map(
  (tool) => tool.name,
);
