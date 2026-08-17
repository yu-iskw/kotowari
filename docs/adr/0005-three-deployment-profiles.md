# ADR-0005: Three profiles — standalone, Compose, GCP Terraform modules

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Kotowari architecture

## Context

The product requires zero-friction individual use, enterprise production, and an enterprise-like laptop environment. Emulating Google Cloud locally is expensive and still inaccurate. Abstracting GCP and AWS behind one runtime interface makes both clouds worse. Semantica’s Compose (Explorer + FalkorDB) and Cloud Run YAML already drifted from each other.

Cloud Run currently distinguishes **services**, **jobs**, and **worker pools**, which match API, finite batch, and continuous consumers.

## Decision

Three **deployment profiles**, one application:

| Profile | Bindings |
| --- | --- |
| Standalone | one Node process, SQLite, filesystem blobs, embedded queue, local principal |
| Enterprise local | Docker Compose: app, worker, PostgreSQL, MinIO, optional Redis/NATS, **dev OIDC** |
| Enterprise GCP | Cloud Run service/jobs/worker pools, AlloyDB or Cloud SQL, GCS, Pub/Sub, Cloud Tasks, Secret Manager, KMS, OIDC/IAM |

- Compose reproduces **ports/contracts** (`BlobStore`, `CanonicalStore`, `IdentityProvider`, `Queue`), not GCP APIs.
- **Terraform modules** (not a single root soup): `network`, `identity`, `data`, `runtime`, `secrets`, `observability`. Environments compose modules.
- **AWS is a later module set**, not a v1 inner `CloudProvider` interface.
- Kubernetes is out of v1.
- Same capability **contract tests** must pass on all three profiles.

## Consequences

**Positive**

- `npx kotowari start` stays zero-config.
- Platform engineers develop identity and workers without a GCP project.
- Production mapping to Cloud Run is honest (service vs job vs pool).
- Multi-cloud later is Terraform duplication of modules, not application forks.

**Negative**

- Compose will not reproduce Cloud IAM edge cases; contract tests must catch semantic gaps.
- Two Terraform trees (GCP now, AWS later) need discipline to keep variables aligned.
- Operators must understand profile differences (embedded vs Redis, local vs OIDC).

## Alternatives considered

- **Compose as mini-GCP (Pub/Sub emulator, etc.):** high cost, low fidelity; rejected.
- **Lowest-common-denominator cloud SDK in the app:** rejected; adapters + Terraform instead.
- **Helm/K8s from day one:** unnecessary given Cloud Run.
- **Single Terraform root with all resources inline:** unmaintainable; use modules.
