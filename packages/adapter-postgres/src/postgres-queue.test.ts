import { describe, expect, it } from 'vitest';

import { createPostgresQueue } from './postgres-queue.js';
import { createPgliteClient } from './sql-client.js';

describe('createPostgresQueue', () => {
  it('enqueue then drain returns both jobs and second drain is empty', async () => {
    const client = await createPgliteClient();
    const queue = createPostgresQueue(client);
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
