import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve as resolvePath } from 'node:path';

import { documentMimeType } from '@kotowari/capability-ingestion';

import type { KotowariApp } from '@kotowari/application';
import type { IngestResult } from '@kotowari/capability-ingestion';

function collectFiles(root: string): string[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.kotowari') {
        continue;
      }
      files.push(...collectFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

export async function ingestFilesystemPath(
  app: KotowariApp,
  target: string,
): Promise<IngestResult> {
  const resolved = resolvePath(target);
  const stats = statSync(resolved);
  const files = stats.isDirectory() ? collectFiles(resolved) : [resolved];
  const documents = files.map((file) => ({
    relativePath: stats.isDirectory() ? relative(resolved, file) : basename(file),
    bytes: new Uint8Array(readFileSync(file)),
    mimeType: documentMimeType(file),
  }));
  return app.ingestDocuments(documents);
}
