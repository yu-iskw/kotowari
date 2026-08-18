# Kotowari

Kotowari is the context-and-accountability layer under agents and applications. It remembers what they knew, what they chose, where the facts came from, which policy was in force, and what happened afterward.

It does not replace Cursor, Claude Code, ADK, or Vertex AI. Those systems act. Kotowari makes their work sourced, replayable, and shareable.

## Getting started

### Prerequisites

- [pnpm](https://pnpm.io/) **11.x** (see `packageManager` in `package.json`; use [Corepack](https://nodejs.org/api/corepack.html): `corepack enable`)
- Node.js **22+** (see `engines` in `package.json`; `.node-version` pins the version)

### Installation

```bash
pnpm install
pnpm build
```

### Standalone (no Docker)

```bash
pnpm --filter kotowari exec node dist/cli.js init
pnpm --filter kotowari exec node dist/cli.js start
```

Or after a global/workspace link: `npx kotowari init && kotowari start`.

Then ingest a folder (`kotowari ingest ./testdata/vendor-x`) and search in the web UI or via REST/MCP.

### Quality gates

```bash
pnpm verify   # build, eslint, knip, tests — default CI for Cloud agents
pnpm test
pnpm lint:eslint
```

Default `verify` is offline. No Vertex, no Postgres, no live IdP.

## What this repo contains

Phase 0–1 standalone vertical slice: kernel invariants, SQLite canonical store, filesystem blobs, ingest → claims → retrieval with explanations → context snapshots → decision records, REST + MCP 2026-07-28, CLI, a small web UI, and thin agent/model plugins.

Design docs live in [`docs/`](./docs/): [product-design.md](./docs/product-design.md), [system-design.md](./docs/system-design.md), [quality-assurance.md](./docs/quality-assurance.md), [ADRs](./docs/adr/README.md).

## Layout

- `packages/kernel` — domain types and invariants
- `packages/application` — commands over capability packs
- `packages/adapter-sqlite` / `packages/adapter-fs` — standalone ports
- `packages/protocol-rest` / `packages/protocol-mcp` — transports
- `apps/cli`, `apps/server`, `apps/web` — product surfaces
- `plugins/` — fake/Vertex model adapters and the Cursor pack

## License

Apache-2.0
