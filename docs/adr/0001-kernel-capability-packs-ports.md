# ADR-0001: Kernel + capability packs + ports/adapters

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Kotowari architecture

## Context

Kotowari must stay pleasant for one developer on a laptop and correct for enterprise tenancy, provenance, and policy. Semantica-style “every concept is an equally independent module” explodes the public API and invites coding agents to bypass boundaries. Microservices from day one turn schema evolution, authz propagation, and the claim→evidence→provenance→outbox invariant into distributed-systems work before the product is understood. A naive modular monolith is simple to deploy but lets modules import each other’s internals and runs untrusted plugins in-process.

We also need heavy ingestion, embedding, and projection work to scale independently _later_ without rewriting domain contracts.

## Decision

Build a **TypeScript modular-monolith kernel** with:

1. A tiny **kernel** for Entity, Claim, Evidence, Decision, Policy, Event, Artifact, Context, Provenance, ACL hooks, and invariants.
2. **Capability packs** (`knowledge`, `context`, `memory`, `ingestion`, `retrieval`, `ontology`, `policy`, `provenance`) that implement product behavior against kernel contracts.
3. **Ports/adapters** for storage, model, identity, queue, blob, and protocols (REST, MCP, A2A).
4. **Location-transparent executors:** each heavy capability has a local in-process executor and a distributed executor (Cloud Run Job / worker pool later). Code modularity is not a deployment monolith.

Plugin isolation: L0 compile-time and L1 trusted dynamic load in v1; L2 child process and L3 remote protocol when isolation or language diversity is required.

CI enforces package boundaries (`package-boundary.yaml` / architecture tests). Compile success is not enough.

## Consequences

**Positive**

- One transaction can commit claim + evidence link + provenance + ACL + outbox.
- Standalone is one Node process; enterprise rebinds ports.
- Coding agents extend a pack or adapter, not a 27-module soup.
- Workers can move out of process without changing semantic contracts.

**Negative**

- Ports must be designed with at least two implementations in mind (SQLite and Postgres; filesystem and GCS) to avoid speculative abstraction.
- In-process L1 plugins can still crash the server; untrusted plugins wait for L2.
- Teams must resist “just import the other pack’s internals.”

## Alternatives considered

- **Semantica-style highly modular library:** excellent composition, poor platform invariants and AI-coding blast radius.
- **Microservices from day one:** rejected for v1; premature consistency and ops cost.
- **Distributed plugin platform as the foundation:** maximum isolation, reinvented orchestration; adopt selectively later (L2/L3).
- **Deployment monolith forever:** rejected; distinguish codebase monolith from topology.
