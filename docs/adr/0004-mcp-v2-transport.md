# ADR-0004: MCP 2026-07-28 as a transport adapter

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Kotowari architecture

## Context

Semantica’s MCP server embeds graph/decision logic behind stdio tools and documents no remote HTTP/SSE hosting. MCP specification **2026-07-28** (“MCP v2” in Kotowari docs) makes the protocol core **stateless**: no required initialize handshake, no `Mcp-Session-Id` on the core path, Streamable HTTP headers `Mcp-Method` and `Mcp-Name`, hardened OAuth (CIMD, RFC 8707 resource audience, RFC 9207 `iss`). MCP Apps and Tasks are extensions. Elicitation uses multi-round-trip `input_required`.

If tools own business logic, REST, SDK, and MCP will diverge on authorization and provenance.

## Decision

- Implement **one application command/query layer**. `protocol-mcp` only translates MCP JSON-RPC ↔ commands.
- **Primary remote transport:** Streamable HTTP per 2026-07-28, deployable on Cloud Run (and Compose) without sticky sessions.
- **Local IDE:** stdio against standalone Kotowari remains supported.
- **Capability-scoped servers/paths:** `/mcp/retrieve`, `/mcp/knowledge`, `/mcp/memory`, `/mcp/ingestion`, `/mcp/admin` so coding agents are not offered admin tools by default.
- **Auth:** HTTP OAuth 2.1-shaped flow, Protected Resource Metadata, audience-bound tokens, CIMD; DCR only as deprecated fallback.
- **MCP Apps:** optional presentation (inspectors), not the core web framework.
- **A2A:** separate protocol for opaque agent-to-agent tasks; do not expose every worker as an Agent Card.
- Optionally accept pre-2026-07-28 Streamable HTTP during a documented deprecation window.

Gateways may route and rate-limit on `Mcp-Method` / `Mcp-Name` without parsing bodies. Header/body mismatch is rejected.

## Consequences

**Positive**

- Identical policy and provenance on REST, MCP, SDK, A2A.
- Horizontal scale on ordinary HTTP load balancers / Cloud Run.
- Least-privilege tool profiles for IDEs vs admin vs ingestion.
- MCP Apps reuse the same commands for in-chat inspectors.

**Negative**

- Clients must speak 2026-07-28 (or the compatibility window).
- Stdio and HTTP auth models differ; standalone vs enterprise plugin config must be explicit.
- Long-running work uses Tasks / jobs, not protocol sessions.

## Alternatives considered

- **Stdio-only MCP (Semantica):** fails enterprise coding agents and Cloud Run.
- **Business logic inside tool handlers:** guaranteed drift.
- **Single MCP server with all tools:** unsafe default for coding agents.
- **A2A instead of MCP:** wrong layer (agent↔agent vs agent↔tools).
