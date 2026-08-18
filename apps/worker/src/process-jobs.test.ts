import { describe, expect, it } from 'vitest';

import { runWorkerOnce } from './process-jobs.js';

import type { KotowariApp } from '@kotowari/application';

describe('worker drain', () => {
  it('runWorkerOnce consumes queued ingest.documents jobs', async () => {
    let remaining = 1;
    const app = {
      processQueuedJobs: async () => {
        const count = remaining;
        remaining = 0;
        return count;
      },
    } as Pick<KotowariApp, 'processQueuedJobs'> as KotowariApp;
    expect(await runWorkerOnce(app)).toBe(1);
    expect(await runWorkerOnce(app)).toBe(0);
  });
});
