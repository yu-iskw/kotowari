import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { retrieveToolNames, retrieveToolsDocument, PACKAGE_NAME } from './public.js';

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

describe('retrieve profile tool list snapshot', () => {
  it('retrieveToolNames matches tools.json and excludes admin tools', () => {
    const toolsJson = JSON.parse(
      readFileSync(join(packageDir, 'generated/tools.json'), 'utf8'),
    ) as { tools: { name: string }[] };
    const jsonNames = toolsJson.tools.map((tool) => tool.name);

    expect(retrieveToolNames).toEqual(jsonNames);
    expect(retrieveToolNames).toEqual([
      'search_knowledge',
      'search_memory',
      'record_decision',
      'search_decisions',
    ]);
    const decision = retrieveToolsDocument.tools.find((tool) => tool.name === 'record_decision');
    expect(decision?.inputSchema).toMatchObject({ required: ['selectedOutcome'] });

    for (const name of retrieveToolNames) {
      expect(name).not.toContain('admin');
      expect(name).not.toBe('unrestricted_ingest');
    }

    for (const tool of retrieveToolsDocument.tools) {
      expect(tool.name).not.toContain('admin');
      expect(tool.name).not.toBe('unrestricted_ingest');
    }
  });
});
