import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { cursorPluginManifest, PACKAGE_NAME } from './public.js';

const packageDir = dirname(fileURLToPath(import.meta.url));

describe('public', () => {
  it('exports PACKAGE_NAME', () => {
    expect(PACKAGE_NAME).toBe('@kotowari/agent-cursor');
  });
});

describe('ADR-0009 agent pack must not import kernel', () => {
  it('package.json dependencies must not include @kotowari/kernel', () => {
    const packageJson = JSON.parse(readFileSync(join(packageDir, '../package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const allDeps = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
      ...packageJson.peerDependencies,
    };
    expect(allDeps).not.toHaveProperty('@kotowari/kernel');
    for (const name of Object.keys(allDeps)) {
      expect(name).not.toBe('@kotowari/kernel');
    }
  });
});

describe('standalone MCP configuration', () => {
  it('uses one zero-config personal MCP server', () => {
    expect(Object.keys(cursorPluginManifest.mcpServers ?? {})).toEqual(['kotowari']);
    expect(cursorPluginManifest.mcpServers?.['kotowari']).toEqual({
      command: 'kotowari',
      args: ['mcp'],
    });
  });
});
