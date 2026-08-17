import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  asPrincipalId,
  blobStoreComplianceTests,
  localStandalonePrincipal,
} from '@kotowari/plugin-sdk';
import { describe, expect, it } from 'vitest';

import {
  createDevOidcIdentityProvider,
  createEmbeddedQueue,
  createFileBlobStore,
  createLocalIdentityProvider,
} from './public.js';

blobStoreComplianceTests(() => {
  const dir = mkdtempSync(join(tmpdir(), 'kotowari-blob-'));
  return createFileBlobStore(dir);
});

describe('createEmbeddedQueue', () => {
  it('enqueue then drain returns copy and clears', async () => {
    const queue = createEmbeddedQueue();
    await queue.enqueue({ kind: 'sync', payload: { id: '1' } });
    await queue.enqueue({ kind: 'notify', payload: { message: 'hello' } });

    const drained = await queue.drain();
    expect(drained).toEqual([
      { kind: 'sync', payload: { id: '1' } },
      { kind: 'notify', payload: { message: 'hello' } },
    ]);
    expect(await queue.drain()).toEqual([]);
  });
});

describe('createLocalIdentityProvider', () => {
  it('returns local standalone principal by default', async () => {
    const provider = createLocalIdentityProvider();
    const principal = await provider.currentPrincipal();
    expect(principal).toEqual(localStandalonePrincipal());
  });

  it('returns provided principal when given', async () => {
    const custom = { ...localStandalonePrincipal(), id: asPrincipalId('custom-user') };
    const provider = createLocalIdentityProvider(custom);
    expect(await provider.currentPrincipal()).toEqual(custom);
  });
});

describe('createDevOidcIdentityProvider', () => {
  it('maps Bearer dev-guest to public clearance', async () => {
    const provider = createDevOidcIdentityProvider();
    const guest = await provider.authenticate?.({ authorization: 'Bearer dev-guest' });
    expect(guest?.clearance).toBe('public');
    const local = await provider.authenticate?.({ authorization: 'Bearer dev-local' });
    expect(local).toEqual(localStandalonePrincipal());
  });
});
