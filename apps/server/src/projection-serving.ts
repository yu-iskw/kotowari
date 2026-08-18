import type { RetrievalCandidateSourcePolicy } from '@kotowari/capability-retrieval';
import type {
  PostgresRetrievalProjection,
  RetrievalProjectionStatus,
} from '@kotowari/adapter-postgres';

export type ProjectionServingSnapshot = RetrievalProjectionStatus & {
  ready: boolean;
  healthy: boolean;
  checkedAt: string;
  lastError?: string;
  projectionSelections: number;
  canonicalFallbacks: number;
  projectionErrors: number;
  lastFallbackReason?: 'unavailable' | 'error';
};

export type ProjectionServingGate = {
  policy: RetrievalCandidateSourcePolicy;
  status(): Promise<ProjectionServingSnapshot>;
  metrics(): Promise<string>;
};

export function createProjectionServingGate(
  projection: PostgresRetrievalProjection,
  now: () => Date = () => new Date(),
): ProjectionServingGate {
  let projectionSelections = 0;
  let canonicalFallbacks = 0;
  let projectionErrors = 0;
  let lastError: string | undefined;
  let lastFallbackReason: 'unavailable' | 'error' | undefined;

  const rawStatus = async (): Promise<RetrievalProjectionStatus> => projection.status();

  const status = async (): Promise<ProjectionServingSnapshot> => {
    const checkedAt = now().toISOString();
    try {
      const raw = await rawStatus();
      const ready = !raw.stale && raw.pendingEvents === 0;
      return {
        ...raw,
        ready,
        healthy: ready && lastError === undefined,
        checkedAt,
        projectionSelections,
        canonicalFallbacks,
        projectionErrors,
        ...(lastError === undefined ? {} : { lastError }),
        ...(lastFallbackReason === undefined ? {} : { lastFallbackReason }),
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      return {
        projectionId: projection.id,
        pendingEvents: 0,
        stale: true,
        ready: false,
        healthy: false,
        checkedAt,
        projectionSelections,
        canonicalFallbacks,
        projectionErrors,
        lastError,
        ...(lastFallbackReason === undefined ? {} : { lastFallbackReason }),
      };
    }
  };

  const policy: RetrievalCandidateSourcePolicy = {
    async available() {
      const snapshot = await status();
      return snapshot.ready && snapshot.healthy;
    },
    fallback: 'canonical',
    onSelected() {
      projectionSelections += 1;
      lastError = undefined;
    },
    onFallback(event) {
      canonicalFallbacks += 1;
      lastFallbackReason = event.reason;
      if (event.reason === 'error') {
        projectionErrors += 1;
        lastError = event.error instanceof Error ? event.error.message : String(event.error);
      }
    },
  };

  return {
    policy,
    status,
    async metrics() {
      const snapshot = await status();
      return [
        '# HELP kotowari_projection_ready Whether the retrieval projection is safe to serve.',
        '# TYPE kotowari_projection_ready gauge',
        `kotowari_projection_ready ${snapshot.ready ? '1' : '0'}`,
        '# HELP kotowari_projection_pending_events Canonical events not yet projected.',
        '# TYPE kotowari_projection_pending_events gauge',
        `kotowari_projection_pending_events ${String(snapshot.pendingEvents)}`,
        '# HELP kotowari_projection_selections_total Retrievals served through the projection.',
        '# TYPE kotowari_projection_selections_total counter',
        `kotowari_projection_selections_total ${String(snapshot.projectionSelections)}`,
        '# HELP kotowari_projection_canonical_fallbacks_total Retrievals sent to canonical fallback.',
        '# TYPE kotowari_projection_canonical_fallbacks_total counter',
        `kotowari_projection_canonical_fallbacks_total ${String(snapshot.canonicalFallbacks)}`,
        '# HELP kotowari_projection_errors_total Projection serving failures.',
        '# TYPE kotowari_projection_errors_total counter',
        `kotowari_projection_errors_total ${String(snapshot.projectionErrors)}`,
        '',
      ].join('\n');
    },
  };
}
