import { describe, expect, it } from 'vitest';

import type { BlobStore } from '../ports.js';

export function blobStoreComplianceTests(factory: () => BlobStore | Promise<BlobStore>): void {
  describe('BlobStore compliance', () => {
    it('round-trips bytes and content type', async () => {
      const store = await factory();
      const key = 'artifacts/doc.txt';
      const bytes = Uint8Array.from([104, 101, 108, 108, 111, 32, 107, 111, 116, 111, 119, 97, 114, 105]);
      const contentType = 'text/plain';

      const { uri } = await store.put(key, bytes, contentType);
      expect(uri).toBeTruthy();

      const loaded = await store.get(key);
      expect(loaded).toBeDefined();
      expect(loaded?.contentType).toBe(contentType);
      expect(loaded?.bytes).toEqual(bytes);
    });

    it('returns undefined for missing keys', async () => {
      const store = await factory();
      expect(await store.get('missing/key')).toBeUndefined();
    });
  });
}
