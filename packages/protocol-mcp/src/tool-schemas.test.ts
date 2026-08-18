import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PROFILE_TOOLS, TOOL_SCHEMAS } from './public.js';

describe('ADR-0009 generated Cursor pack matches tool contracts', () => {
  it('retrieve tools.json matches PROFILE_TOOLS and TOOL_SCHEMAS', () => {
    const packPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../plugins/agent-cursor/src/generated/tools.json',
    );
    const generated = JSON.parse(readFileSync(packPath, 'utf8')) as {
      tools: { name: string; inputSchema: unknown }[];
    };
    expect(generated.tools.map((tool) => tool.name)).toEqual([...PROFILE_TOOLS.retrieve]);
    for (const tool of generated.tools) {
      expect(tool.inputSchema).toEqual(TOOL_SCHEMAS[tool.name]?.inputSchema);
    }
  });
});
