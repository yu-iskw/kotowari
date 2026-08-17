import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROFILE_TOOLS, toolDescriptor } from '@kotowari/protocol-mcp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const toolsPath = join(root, 'plugins/agent-cursor/src/generated/tools.json');

const tools = PROFILE_TOOLS.retrieve.map((name) => toolDescriptor(name));
mkdirSync(dirname(toolsPath), { recursive: true });
writeFileSync(toolsPath, `${JSON.stringify({ tools }, null, 2)}\n`);
