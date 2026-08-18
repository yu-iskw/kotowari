import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { MCP_OPERATIONS, PROFILE_TOOLS } from './public.js';

function generatedRetrieveTools(): {
  tools: { name: string; description: string; inputSchema: unknown }[];
} {
  const packPath = join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../plugins/agent-cursor/src/generated/tools.json',
  );
  return JSON.parse(readFileSync(packPath, 'utf8')) as {
    tools: { name: string; description: string; inputSchema: unknown }[];
  };
}

function embeddedInputSchema(schema: z.ZodType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { io: 'input' });
  const { $schema: _schemaDeclaration, ...embedded } = generated;
  return embedded;
}

describe('ADR-0009 generated Cursor pack matches canonical MCP operations', () => {
  it('retrieve tools.json is generated from the retrieve operation contracts', () => {
    const generated = generatedRetrieveTools();
    expect(generated.tools.map((tool) => tool.name)).toEqual([...PROFILE_TOOLS.retrieve]);

    for (const tool of generated.tools) {
      const operation = MCP_OPERATIONS[tool.name as keyof typeof MCP_OPERATIONS];
      expect(operation).toBeDefined();
      expect(tool.description).toBe(operation?.description);
      expect(tool.inputSchema).toEqual(
        embeddedInputSchema(operation?.inputSchema ?? z.never()),
      );
    }
  });
});
