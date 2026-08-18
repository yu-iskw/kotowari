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

function readJson<T>(absolutePath: string): T {
  const raw = readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw) as T;
}

export const cursorPluginManifest: CursorPluginManifest = readJson(
  join(packageRoot, '.cursor-plugin/plugin.json'),
);
