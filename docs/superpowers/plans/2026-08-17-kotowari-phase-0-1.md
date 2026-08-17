# Kotowari Phase 0-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a standalone Kotowari vertical slice: ingest files, store evidenced claims with provenance, retrieve with explanations, assemble purpose-built context, record decisions, and serve the same commands over REST, MCP 2026-07-28, CLI, and a small web UI.

**Architecture:** TypeScript modular monolith. Kernel holds entities, claims, evidence, decisions, policy, namespaces, and invariants. Capability packs implement product behavior against ports. SQLite and the filesystem bind those ports for the laptop profile. REST and MCP are transport adapters over one application command layer.

**Tech Stack:** Node.js 24, pnpm 11 workspace, TypeScript, Vitest, `node:sqlite`, `node:http`, fast-check for property tests. No Vertex, Postgres, or network on the default verify path.

## Global Constraints

- TypeScript is the product language; default `verify` must not require Python (ADR-0003).
- Kernel must not import protocol, adapter, Vertex, or Postgres packages (ADR-0001).
- Every semantic write requires compact provenance; kernel rejects writes without it (ADR-0007).
- Decisions are records with a context snapshot; hidden chain-of-thought is not stored (ADR-0008).
- Agent plugins must not import `packages/kernel` (ADR-0009).
- Authorization is `allow(principal, action, resource, context)`; standalone still has a real local principal (ADR-0010).
- MCP Streamable HTTP requires `MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`; header/body mismatch is `-32020` (ADR-0004).
- Default CI is offline: fake model/extraction providers, SQLite, filesystem blobs.
- Filenames are kebab-case; public package entry is `src/public.ts`.
- Test titles include story IDs (`S1`) and ADR IDs (`ADR-0007`).
- Package manager is pnpm; Apache-2.0 license is unchanged.

---

## File map

- `packages/kernel` — domain types, invariants, `allow()`, events
- `packages/plugin-sdk` — ports, compliance test factories, architecture lint
- `packages/adapter-sqlite` — canonical SQL store + FTS + embedding table
- `packages/adapter-fs` — filesystem blob store, embedded queue, local identity
- `packages/application` — commands and queries
- `packages/capability-*` — knowledge, context, memory, ingestion, retrieval, ontology, policy, provenance
- `packages/protocol-rest` / `packages/protocol-mcp` / `packages/sdk`
- `apps/cli` / `apps/server` / `apps/web`
- `plugins/model-fake` / `plugins/model-vertex` / `plugins/agent-cursor`
- `testdata/` — frozen ingest corpus

## Task outline

1. Workspace init (replace template `common` package, pnpm workspace globs, `pnpm verify`).
2. Kernel with invariant and authorization tests.
3. Plugin-sdk ports and `*ComplianceTests(factory)`.
4. SQLite + filesystem adapters registered to those factories.
5. Application + capabilities for ingest, retrieve, context, decision, memory, policy.
6. REST + MCP goldens + SDK client.
7. CLI `init|start|ingest|doctor`, server, web UI.
8. Thin plugins and testdata.
9. Verify, commit, PR.

Each task is independently testable. Phase 2 Compose/Postgres and Phase 3 GCP are out of this slice except documented stubs (`infra/compose`, Terraform module READMEs).
