import { blobStoreComplianceTests } from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import { createS3BlobStore, startInProcessS3 } from './public.js';

blobStoreComplianceTests(async () => {
  const { endpoint } = await startInProcessS3();
  return createS3BlobStore({
    endpoint,
    bucket: 'kotowari',
    accessKeyId: 'kotowari',
    secretAccessKey: 'kotowari-secret',
  });
});

describe('createS3BlobStore', () => {
  it('returns undefined for a missing key', async () => {
    const { endpoint, close } = await startInProcessS3();
    try {
      const store = createS3BlobStore({
        endpoint,
        bucket: 'kotowari',
        accessKeyId: 'kotowari',
        secretAccessKey: 'kotowari-secret',
      });
      expect(await store.get('missing/key')).toBeUndefined();
    } finally {
      await close();
    }
  });

  it('put returns the path-style object URL', async () => {
    const { endpoint, close } = await startInProcessS3();
    try {
      const store = createS3BlobStore({
        endpoint,
        bucket: 'kotowari',
        accessKeyId: 'kotowari',
        secretAccessKey: 'kotowari-secret',
      });
      const { uri } = await store.put('a/b.txt', Uint8Array.from([1, 2, 3]), 'text/plain');
      expect(uri).toBe(`${endpoint}/kotowari/a/b.txt`);
    } finally {
      await close();
    }
  });
});
