# ADR-0009: Agent plugins are thin MCP/SDK packs

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Kotowari architecture

## Context

Kotowari must support Claude Code, Cursor, Codex, OpenCode, Claude Agent SDK, ADK, Mastra, DeepAgent, and future tools. Deep, framework-specific integrations in core (Semantica’s Agno/CrewAI-style) create a combinatorics tax and leak framework types into the domain.

The durable interfaces are HTTP, MCP v2, A2A, and a TypeScript SDK. IDEs want plugins (Cursor `.cursor-plugin`, Claude marketplace plugins) with skills and MCP config. Skills that hand-document a huge API drift immediately.

## Decision

- **Compatibility hierarchy:** standards (MCP, A2A, HTTP) → TypeScript SDK → tiny adapters (`createAdkTool(client)`, `createClaudeMcpServer(client)`, `createMastraTool(client)`).
- **First-party packs:** `plugins/agent-cursor`, `plugins/agent-claude-code`, `plugins/agent-claude-sdk` (and siblings) containing manifests, generated skills, and MCP connection config only.
- Packs **must not** import `packages/kernel`. They speak MCP or the public SDK.
- **Generate** skill text and tool descriptors from JSON Schema / `contracts.ts`.
- Frameworks never become kernel dependencies.
- A2A exposes a few named domain agents, not the plugin pack itself.

## Consequences

**Positive**

- New IDEs are config + generated skills.
- Core stays stable when Mastra or ADK versions churn.
- Least-privilege MCP profiles (ADR-0004) apply to plugins uniformly.
- AI coding agents can update a pack without touching capability code.

**Negative**

- UX per IDE still needs a small amount of native manifest work (Cursor vs Claude).
- Features that exist only in one framework (e.g. a proprietary memory API) will not be wrapped unless they map to Kotowari commands.
- Generated skills must be regenerated in CI or they will rot.

## Alternatives considered

- **Deep in-core integrations per framework:** rejected.
- **Replace agent frameworks with Kotowari’s own runtime:** not the product.
- **Hand-written SKILL.md as source of truth:** rejected; schema is source of truth.
