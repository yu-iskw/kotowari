# Retrieval rollout Prometheus policy

Kotowari's server exports process-local retrieval projection and rollout metrics. This directory turns those raw signals into a fleet-level, time-windowed rollout policy that an external operator or deployment controller can consume.

## Rollout cohort contract

The rules aggregate by the Prometheus `job` label. Treat one `job` as one independently controlled rollout cohort (for example one environment, region, or service revision group). All replicas in the cohort must be scraped with the same `job` value.

Do not place independently controlled production and staging replicas in the same `job`. If a metrics backend uses a different cohort label, translate the rules when installing them rather than changing the application metrics.

## Evidence window and defaults

The rule bundle uses a rolling 15-minute window and mirrors the in-process guardrails introduced by the server rollout SLO evaluator:

| Guardrail | Default |
| --- | ---: |
| Minimum projection attempts before promotion | 100 |
| Maximum projection error ratio | 1% |
| Maximum canonical fallback ratio | 2% |
| Maximum shadow ordered-candidate mismatch ratio | 10% |
| Promotion stability period | 5 minutes |

The minimum sample check prevents a quiet cohort from being promoted on a handful of successful requests. The five-minute `for` period requires the 15-minute window to remain within guardrails instead of treating one evaluation as sufficient evidence.

## Signals

Recording rules derive fleet-level 15-minute counts and ratios for projection attempts, user searches, projection errors, canonical fallbacks, and shadow mismatches. They also calculate the minimum projection readiness across replicas and the number of effective rollout modes present in a cohort.

The alert rules produce three classes of operator signal:

- `action="rollback"`: move the cohort to `disabled` and investigate before retrying;
- `action="hold"`: do not advance the rollout stage;
- `action="promote"`: the cohort is eligible for operator-approved progression to the `target_mode`.

Promotion alerts are deliberately informational. Kotowari does not mutate deployment configuration from inside the serving process.

## Safety rules

A cohort is never considered promotable when replicas disagree about the effective rollout mode, any replica reports the projection as unready, the local circuit breaker is active, or the relevant error/parity budget is breached.

`KotowariRetrievalRolloutModeSplitBrain` is especially important for multi-replica deployments: it detects configuration or rollout skew where the same cohort reports more than one effective mode. Resolve that skew before trusting promotion signals.

## Installation

Load `retrieval-rollout.rules.yml` into a Prometheus-compatible rule evaluator. The exact installation mechanism belongs to the deployment provider; the repository intentionally keeps these rules outside the server and outside a cloud-specific Terraform implementation.

Before deployment, validate the bundle with:

```bash
docker run --rm \
  --workdir /rules \
  --volume "$PWD/infra/observability/prometheus:/rules:ro" \
  --entrypoint /bin/promtool \
  prom/prometheus:v3.13.1 \
  check rules retrieval-rollout.rules.yml

docker run --rm \
  --workdir /rules \
  --volume "$PWD/infra/observability/prometheus:/rules:ro" \
  --entrypoint /bin/promtool \
  prom/prometheus:v3.13.1 \
  test rules retrieval-rollout.rules.test.yml
```

CI runs both commands whenever the rule bundle or the server metrics that feed it change.

## Promotion sequence

Use the alerts as evidence for a controlled rollout, not as unconditional commands:

```text
disabled
   |
   | operator enables shadow
   v
shadow --(ShadowReadyForCanary)--> canary --(CanaryReadyForEnabled)--> enabled
   |                               |                                |
   +-------- hold on drift --------+-------- rollback on breach ----+
                                            |
                                            v
                                         disabled
```

For automated production promotion, put a deployment controller or GitOps workflow outside the Kotowari process. That controller should require the promotion alert to remain active, verify no rollback/hold alert is firing, update one rollout cohort atomically, and record the change in the deployment audit trail.

## Limits

These rules assume counters are continuously scraped and use `job` as the cohort identity. They do not solve global rollout coordination, deployment locking, change approval, or audit logging. Those concerns belong to the deployment/control plane and should remain independent from retrieval correctness logic.
