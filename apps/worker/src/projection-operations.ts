import type { RetrievalProjectionMaintenance, RetrievalProjectionStatus } from '@kotowari/server';

export type ProjectionOperationalStatus = RetrievalProjectionStatus & {
  ready: boolean;
  healthy: boolean;
  lagMs: number;
  maxLagMs: number;
  lastAttemptAt?: string;
  lastSuccessfulSyncAt?: string;
  lastError?: string;
};

export type ProjectionOperations = {
  syncOnce(): Promise<ProjectionOperationalStatus>;
  rebuild(): Promise<ProjectionOperationalStatus>;
  status(): Promise<ProjectionOperationalStatus>;
  run(options?: { signal?: AbortSignal }): Promise<void>;
};

export type ProjectionOperationsOptions = {
  syncIntervalMs?: number;
  retryIntervalMs?: number;
  maxLagMs?: number;
  now?: () => Date;
};

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

function lagMs(status: RetrievalProjectionStatus, now: Date): number {
  if (!status.stale || status.latestRelevantEventAt === undefined) return 0;
  const eventTime = Date.parse(status.latestRelevantEventAt);
  return Number.isFinite(eventTime) ? Math.max(0, now.getTime() - eventTime) : 0;
}

function waitFor(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });
}

export function createProjectionOperations(
  projection: RetrievalProjectionMaintenance,
  options: ProjectionOperationsOptions = {},
): ProjectionOperations {
  const syncIntervalMs = positive(options.syncIntervalMs, 1_000);
  const retryIntervalMs = positive(options.retryIntervalMs, 2_000);
  const maxLagMs = positive(options.maxLagMs, 30_000);
  const now = options.now ?? (() => new Date());
  let lastAttemptAt: string | undefined;
  let lastSuccessfulSyncAt: string | undefined;
  let lastError: string | undefined;

  const status = async (): Promise<ProjectionOperationalStatus> => {
    const raw = await projection.status();
    const currentLagMs = lagMs(raw, now());
    const ready = !raw.stale && raw.pendingEvents === 0 && currentLagMs <= maxLagMs;
    return {
      ...raw,
      ready,
      healthy: ready && lastError === undefined,
      lagMs: currentLagMs,
      maxLagMs,
      ...(lastAttemptAt === undefined ? {} : { lastAttemptAt }),
      ...(lastSuccessfulSyncAt === undefined ? {} : { lastSuccessfulSyncAt }),
      ...(lastError === undefined ? {} : { lastError }),
    };
  };

  const execute = async (operation: () => Promise<void>): Promise<ProjectionOperationalStatus> => {
    lastAttemptAt = now().toISOString();
    try {
      await operation();
      lastSuccessfulSyncAt = now().toISOString();
      lastError = undefined;
      return status();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  };

  return {
    syncOnce: () => execute(() => projection.sync()),
    rebuild: () => execute(() => projection.rebuild()),
    status,
    async run(runOptions = {}) {
      while (runOptions.signal?.aborted !== true) {
        let delayMs = syncIntervalMs;
        try {
          await execute(() => projection.sync());
        } catch {
          delayMs = retryIntervalMs;
        }
        await waitFor(delayMs, runOptions.signal);
      }
    },
  };
}
