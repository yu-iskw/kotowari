# ADR-0004: MCP 2026-07-28 as a transport adapter

- **Status:** Accepted
- **Date:** 2026-08-17
- **Updated:** 2026-08-18
- **Deciders:** Kotowari architecture

## Context

Kotowari must expose the same knowledge, memory, decision, ingestion, curation, and audit semantics to local coding agents and remote enterprise MCP clients. MCP specification **2026-07-28** makes the protocol core stateless: there is no `initialize`/`initialized` handshake or protocol session, clients carry protocol identity/capabilities per request, and `server/discover` is the discovery RPC. Streamable HTTP standardizes `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` headers and authorization uses OAuth Protected Resource Metadata.

If Kotowari owns JSON-RPC codecs or duplicates business contracts inside MCP handlers, protocol evolution and contract drift become Kotowari maintenance obligations. If an endpoint name is treated as authorization, SDK/REST/worker paths can bypass the intended security boundary.

Standalone and enterprise deployments also optimize for different outcomes. An individual running Kotowari locally should not need to understand enterprise endpoint taxonomy or configure several MCP servers just to use knowledge, memory, and decisions. A shared enterprise deployment, however, needs independently scoped capability boundaries for least privilege, OAuth policy, and audit.

## Decision

- Implement **one application command/query layer**. MCP, REST, SDK, and later A2A invoke the same application operations; authorization and provenance live below transports.
- Use the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`) for 2026-07-28 protocol serving. Kotowari does not implement its own MCP JSON-RPC wire codec.
- **Do not support legacy MCP protocol revisions.** HTTP and stdio serving use the SDK's modern-only mode (`legacy: 'reject'`). There is no compatibility/deprecation window.
- **Primary remote transport:** stateless Streamable HTTP, deployable behind ordinary load balancers and Cloud Run without sticky sessions.
- **Local IDE transport:** stdio against standalone Kotowari.
- Make one canonical operation registry the source of truth for operation name, description, input/output validation, application command, action, risk, OAuth scope, and execution.
- Construct MCP servers from explicit operation sets. Enterprise profiles and standalone presets are selectors over the same operation registry rather than separate implementations.
- Treat **enterprise profiles** as security/exposure boundaries. Enterprise and enterprise-like Compose expose profile-specific `/mcp/{profile}` endpoints:

  | Profile          | Risk       | Operations                          |
  | ---------------- | ---------- | ----------------------------------- |
  | `retrieve`       | read       | `search_knowledge`, `search_memory` |
  | `decision-read`  | read       | `replay_decision`                   |
  | `decision-write` | write      | `record_decision`                   |
  | `audit`          | privileged | `audit_decision`, `export_prov`     |
  | `memory-write`   | write      | `record_memory`                     |
  | `curation`       | privileged | `resolve_conflict`                  |
  | `ingestion`      | write      | `ingest_path`                       |
  | `admin`          | privileged | `list_policies`, `what_if_policy`   |

- Treat **standalone presets** as local UX/safety choices rather than OAuth boundaries. `kotowari mcp` defaults to `personal`; standalone HTTP exposes the same preset at `/mcp`:

  | Preset     | Purpose | Operations |
  | ---------- | ------- | ---------- |
  | `readonly` | Conservative local access | `search_knowledge`, `search_memory`, `replay_decision`, `audit_decision` |
  | `personal` | Everyday individual use (default) | `search_knowledge`, `search_memory`, `record_memory`, `record_decision`, `replay_decision`, `audit_decision` |
  | `advanced` | Explicit power-user access | all registered MCP operations |

- Do not expose filesystem ingestion, conflict curation, policy administration, or PROV export in the default `personal` preset. These remain explicit CLI or advanced/enterprise capabilities.
- The standalone CLI uses `--preset`, not `--profile`; enterprise profiles are an HTTP deployment concern. The default Cursor pack launches a single `kotowari mcp` process and inherits the `personal` preset.
- Treat enterprise profile/scope authorization and resource authorization as two distinct layers:
  1. OAuth scope answers whether the caller may invoke an operation/profile.
  2. Application/kernel authorization answers whether the authenticated principal may access the specific tenant/namespace/resource for the request purpose/delegation.
- Enterprise HTTP acts as an OAuth protected resource. It publishes RFC 9728 Protected Resource Metadata, requires audience-bound Bearer tokens, maps verified token claims to `Principal`, and fails closed before MCP dispatch when authentication/scopes are missing.
- The initial production token adapter uses OAuth token introspection and validates active/expiry/audience and configured issuer. The `IdentityProvider`/MCP verifier port keeps the authorization server replaceable.
- Enterprise MCP HTTP applies bounded request bodies, deadlines, rate limiting, host/origin validation, request IDs, and structured audit events that omit tool arguments/results by default.
- Enterprise Cloud Run binding listens on `0.0.0.0`; standalone and development Compose remain loopback-only by default.
- MCP tool calls return standard `content` plus validated `structuredContent` governed by `outputSchema`.
- MCP Apps remain an optional presentation layer, not the core web framework. Long-running work may later use the MCP Tasks extension or Kotowari jobs.
- A2A remains a separate protocol for opaque agent-to-agent tasks; do not expose every worker as an Agent Card.

## Consequences

**Positive**

- Protocol conformance and `server/discover` stay aligned with the official SDK instead of hand-written Kotowari codecs.
- Invalid inputs fail validation instead of silently coercing into empty/default domain values.
- MCP schemas cannot drift from handlers such as the former `record_decision.alternatives` mismatch.
- Enterprise read-only and write/privileged surfaces are mechanically separable and independently scopeable.
- Standalone users get one useful zero-configuration MCP surface instead of enterprise profile ceremony.
- Standalone does not expose high-impact ingestion, curation, administration, or export capabilities by default.
- OAuth edge authorization composes with tenant/namespace/classification/delegation authorization rather than replacing it.
- The same application-layer authorization protects MCP, REST, SDK, and worker callers.
- Stateless serving scales horizontally on ordinary HTTP infrastructure.

**Negative**

- Clients must support MCP 2026-07-28; older clients are intentionally rejected.
- Kotowari now has two selection concepts: local UX-oriented presets and enterprise security-oriented profiles. Their distinction must stay explicit in naming and documentation.
- The `advanced` standalone preset intentionally grants broad local agent capability and therefore must remain an explicit user choice.
- Production OAuth requires authorization-server metadata/configuration and token claim mapping.
- In-memory rate limiting is per-process; a shared/distributed limiter is needed if an organization requires a globally strict quota across Cloud Run instances.

## Alternatives considered

- **Continue the hand-written JSON-RPC implementation:** rejected because protocol conformance is nondifferentiating maintenance and had already drifted from 2026-07-28 semantics.
- **Keep backward compatibility:** rejected for now; Kotowari targets the current MCP revision and does not carry legacy protocol code.
- **Profiles everywhere, including standalone:** rejected because it leaks enterprise deployment/security taxonomy into the individual UX and requires multiple local MCP configurations for ordinary use.
- **Single standalone MCP server with all tools by default:** rejected because it unnecessarily gives local agents ambient ingestion, curation, administration, and export capabilities.
- **Separate standalone read and write servers:** rejected because the extra configuration cost is too high for ordinary individual use; the `readonly` preset remains available when a user needs a conservative surface.
- **Separate deployable microservice per enterprise profile:** rejected as premature operational complexity; profiles are logical endpoints within the modular monolith.
- **OAuth scopes as the only authorization layer:** rejected because they cannot express Kotowari resource/tenant/namespace/classification/delegation rules.
- **A2A instead of MCP:** rejected because agent-to-agent and agent-to-tool interfaces solve different problems.
