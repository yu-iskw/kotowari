import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  cursorPluginManifest,
  decisionToolNames,
  decisionToolsDocument,
  retrieveToolNames,
  PACKAGE_NAME,
} from './public.js';

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

describe('capability-scoped MCP tool snapshots', () => {
  it('keeps retrieve read-only and decision recording on its own server', () => {
    expect(retrieveToolNames).toEqual(['search_knowledge', 'search_memory']);
    expect(decisionToolNames).toEqual(['record_decision']);
    const decision = decisionToolsDocument.tools.find((tool) => tool.name === 'record_decision');
    expect(decision?.inputSchema).toMatchObject({ required: ['selectedOutcome'] });
    expect(cursorPluginManifest.mcpServers).toHaveProperty('kotowari-retrieve');
    expect(cursorPluginManifest.mcpServers).toHaveProperty('kotowari-decision');
  });
});
