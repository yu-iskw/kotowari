import { createComposeAppFromEnv, createInProcessComposeApp } from '@kotowari/server';

import { runWorkerLoop } from './process-jobs.js';

export async function startWorker(
  env: Record<string, string | undefined> = process.env,
): Promise<{ close: () => Promise<void> }> {
  if (env['DATABASE_URL'] !== undefined && env['DATABASE_URL'].length > 0) {
    const app = createComposeAppFromEnv(env);
    const abort = new AbortController();
    const running = runWorkerLoop(app, { signal: abort.signal });
    return {
      close: async () => {
        abort.abort();
        await running;
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
