import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const kotowariAliases: Record<string, string> = {
  '@kotowari/kernel': path.join(root, 'packages/kernel/src/public.ts'),
  '@kotowari/plugin-sdk': path.join(root, 'packages/plugin-sdk/src/public.ts'),
  '@kotowari/application': path.join(root, 'packages/application/src/public.ts'),
  '@kotowari/capability-knowledge': path.join(root, 'packages/capability-knowledge/src/public.ts'),
  '@kotowari/capability-context': path.join(root, 'packages/capability-context/src/public.ts'),
  '@kotowari/capability-memory': path.join(root, 'packages/capability-memory/src/public.ts'),
  '@kotowari/capability-ingestion': path.join(root, 'packages/capability-ingestion/src/public.ts'),
  '@kotowari/capability-retrieval': path.join(root, 'packages/capability-retrieval/src/public.ts'),
  '@kotowari/capability-ontology': path.join(root, 'packages/capability-ontology/src/public.ts'),
  '@kotowari/capability-policy': path.join(root, 'packages/capability-policy/src/public.ts'),
  '@kotowari/capability-provenance': path.join(
    root,
    'packages/capability-provenance/src/public.ts',
  ),
  '@kotowari/adapter-sqlite': path.join(root, 'packages/adapter-sqlite/src/public.ts'),
  '@kotowari/adapter-fs': path.join(root, 'packages/adapter-fs/src/public.ts'),
  '@kotowari/adapter-s3': path.join(root, 'packages/adapter-s3/src/public.ts'),
  '@kotowari/adapter-postgres': path.join(root, 'packages/adapter-postgres/src/public.ts'),
  '@kotowari/protocol-rest': path.join(root, 'packages/protocol-rest/src/public.ts'),
  '@kotowari/protocol-mcp': path.join(root, 'packages/protocol-mcp/src/public.ts'),
  '@kotowari/sdk': path.join(root, 'packages/sdk/src/public.ts'),
  '@kotowari/model-fake': path.join(root, 'plugins/model-fake/src/public.ts'),
  '@kotowari/model-vertex': path.join(root, 'plugins/model-vertex/src/public.ts'),
  '@kotowari/agent-cursor': path.join(root, 'plugins/agent-cursor/src/public.ts'),
  '@kotowari/server': path.join(root, 'apps/server/src/public.ts'),
  '@kotowari/web': path.join(root, 'apps/web/src/public.ts'),
  kotowari: path.join(root, 'apps/cli/src/public.ts'),
};
