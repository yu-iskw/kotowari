# ADR-0003: TypeScript as the product language

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Kotowari architecture

## Context

Kotowari’s required surfaces are REST, MCP (TypeScript SDK first-class for 2026-07-28), MCP Apps, A2A, a web UI, Cursor/Claude plugins, and Terraform-adjacent platform glue. A Python encyclopedia (Semantica) optimized for notebooks and optional extras, with a heavy default ML stack. Individuals need `npx kotowari` without PyTorch. Coding agents and MCP Apps SDKs are strongest in TypeScript.

Python remains the language of many extractors and scientific tools; that does not require Python to own the kernel.

## Decision

- The **product kernel, application layer, protocols, CLI, web, and first-party plugins** are TypeScript (Node or a Web-standards runtime compatible with the MCP TS SDK).
- Python appears only as a future **L2/L3 plugin** (sidecar or remote) if a specific extractor or reasoner has no adequate TS implementation.
- Public clients: TypeScript SDK generated/aligned with OpenAPI + JSON Schema. Other languages consume HTTP/MCP.
- Default dependency diet excludes native ML stacks from the kernel. Model inference is an adapter (Vertex, etc.).

## Consequences

**Positive**

- One language for server, MCP, MCP Apps, and agent plugin packs.
- Stateless MCP v2 maps cleanly to Cloud Run services.
- Standalone install stays small.
- Shared schemas (Zod/JSON Schema) at boundaries for AI coding.

**Negative**

- Some NLP/graph-algorithm libraries are weaker in TS; those wait for workers or L2 plugins.
- Team must be competent in TypeScript and package-boundary discipline.
- Notebook users use the HTTP/SDK path, not `import kotowari` as a scientific library.

## Alternatives considered

- **Python kernel + TS UI:** two products unless a frozen ABI exists; default deps tend to explode (Semantica lesson).
- **Polyglot without a frozen ABI:** rejected; coding agents will cross the wrong boundary.
- **Go/Rust kernel:** excellent ops, weaker MCP Apps / plugin ecosystem for this team’s stated stack.
