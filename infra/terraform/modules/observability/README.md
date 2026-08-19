# observability

Terraform module stub for logs, metrics, traces, and audit sinks aligned with Kotowari provenance events. Standalone mode logs to stdout; enterprise binds structured telemetry and retention policies through this module.

Provider implementations should install or translate the provider-neutral Prometheus-compatible rule bundle under [`infra/observability/prometheus`](../../../observability/prometheus/README.md) rather than duplicating retrieval rollout policy in cloud-specific Terraform. The bundle aggregates process-local server metrics into 15-minute fleet guardrails for rollout hold, promotion, and rollback signals.

The application remains responsible for correctness-preserving canonical fallback and its local circuit breaker. Fleet-wide time windows, alert delivery, change approval, distributed rollout locking, and deployment mutation belong to the observability/deployment control plane.
