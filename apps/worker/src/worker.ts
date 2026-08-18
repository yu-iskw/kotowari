import {
  createComposeAppFromEnv,
  createComposeRetrievalProjectionFromEnv,
  createInProcessComposeApp,
} from '@kotowari/server';

import { runWorkerLoop } from './process-jobs.js';
import { createProjectionOperations } from './projection-operations.js';

import type { ProjectionOperations } from './projection-operations.js';

export type WorkerHandle = {
  close: () => Promise<void>;
  projection?: ProjectionOperations;
};

function positiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function projectionEnabled(env: Record<string, string | undefined>): boolean {
  return (
    env['KOTOWARI_PROFILE'] === 'enterprise' ||
    env['KOTOWARI_RETRIEVAL_PROJECTION'] === 'postgres'
  );
}

export async function startWorker(
  env: Record<string, string | undefined> = process.env,
): Promise<WorkerHandle> {
  if (env['DATABASE_URL'] !== undefined && env['DATABASE_URL'].length > 0) {
    const app = createComposeAppFromEnv(env);
    const abort = new AbortController();
    const jobs = runWorkerLoop(app, { signal: abort.signal });
    if (!projectionEnabled(env)) {
      return {
        close: async () => {
          abort.abort();
          await jobs;
        },
      };
    }

    const projection = createProjectionOperations(createComposeRetrievalProjectionFromEnv(env), {
      syncIntervalMs: positiveInt(env['KOTOWARI_PROJECTION_SYNC_INTERVAL_MS'], 1_000),
      retryIntervalMs: positiveInt(env['KOTOWARI_PROJECTION_RETRY_INTERVAL_MS'], 2_000),
      maxLagMs: positiveInt(env['KOTOWARI_PROJECTION_MAX_LAG_MS'], 30_000),
    });
    const projectionLoop = projection.run({ signal: abort.signal });
    return {
      projection,
      close: async () => {
        abort.abort();
        await Promise.all([jobs, projectionLoop]);
      },
    };
  }
  const inProcess = await createInProcessComposeApp();
  const abort = new AbortController();
  const running = runWorkerLoop(inProcess.app, { signal: abort.signal });
  return {
    close: async () => {
      abort.abort();
      await running;
      await inProcess.close();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void startWorker().then(() => {
    process.stdout.write('Kotowari worker draining queue\n');
  });
}
