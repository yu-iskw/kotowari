# Kotowari Architecture Decision Records

These ADRs freeze irreversible (or expensive-to-reverse) choices for Kotowari. Read [product-design.md](../product-design.md) for value and UX, [system-design.md](../system-design.md) for the full technical picture, and [quality-assurance.md](../quality-assurance.md) for how those choices are proven in CI and by Cursor Cloud agents.

Format: Title, Status, Date, Context, Decision, Consequences, Alternatives considered.

| ID | Title |
| --- | --- |
| [0001](./0001-kernel-capability-packs-ports.md) | Kernel + capability packs + ports/adapters |
| [0002](./0002-sql-canonical-projections.md) | SQL-canonical knowledge; graph/vector/RDF as projections |
| [0003](./0003-typescript-product-language.md) | TypeScript as the product language |
| [0004](./0004-mcp-v2-transport.md) | MCP 2026-07-28 as a transport adapter |
| [0005](./0005-three-deployment-profiles.md) | Three profiles: standalone, Compose, GCP Terraform modules |
| [0006](./0006-vertex-gemini-model-adapters.md) | Vertex AI Gemini as first-class model adapter |
| [0007](./0007-provenance-mandatory.md) | Provenance mandatory; compact schema; PROV-O at the boundary |
| [0008](./0008-decisions-first-class.md) | Decisions are first-class records, not log lines |
| [0009](./0009-agent-plugins-thin-mcp.md) | Agent plugins are thin MCP/SDK packs |
| [0010](./0010-namespaces-policy-authorization.md) | Hierarchical namespaces + policy-based authorization |

A2A, MCP Apps, and plugin isolation levels L0–L3 are consequences of 0001, 0004, and 0009—not separate ADRs.

Maximum: 10 ADRs in this directory.
