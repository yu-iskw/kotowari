import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { BlobStore } from '@kotowari/plugin-sdk';

class FileBlobStore implements BlobStore {
  constructor(private readonly rootDir: string) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<{ uri: string }> {
    const filePath = join(this.rootDir, key);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, bytes);
    writeFileSync(join(this.rootDir, `${key}.content-type`), contentType, 'utf8');
    return { uri: pathToFileURL(filePath).href };
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
    const filePath = join(this.rootDir, key);
    if (!existsSync(filePath)) {
      return undefined;
    }
    const bytes = readFileSync(filePath);
    const contentTypePath = join(this.rootDir, `${key}.content-type`);
    const contentType = existsSync(contentTypePath)
      ? readFileSync(contentTypePath, 'utf8')
      : 'application/octet-stream';
    return { bytes: new Uint8Array(bytes), contentType };
  }
}

export function createFileBlobStore(rootDir: string): BlobStore {
  return new FileBlobStore(rootDir);
}
