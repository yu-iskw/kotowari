import type { KotowariApp } from '@kotowari/application';

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

export function runWorkerOnce(app: KotowariApp): Promise<number> {
  return app.processQueuedJobs();
}

export async function runWorkerLoop(
  app: KotowariApp,
  options: { idleMs?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const idleMs = options.idleMs ?? 500;
  while (!isAborted(options.signal)) {
    const processed = await app.processQueuedJobs();
    if (isAborted(options.signal)) {
      return;
    }
    if (processed === 0) {
      await new Promise((resolve) => {
        setTimeout(resolve, idleMs);
      });
    }
  }
}
