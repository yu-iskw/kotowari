# ADR-0006: Vertex AI Gemini as first-class model adapter

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Kotowari architecture

## Context

Enterprise default for this organization is Google Cloud. Gemini on Vertex AI covers generation, structured output, and embeddings with IAM, data residency, and no long-lived vendor API keys in many setups. Individuals and other teams still need OpenAI, Anthropic, OpenRouter, and local models.

Collapsing “the LLM” into one interface hides missing capabilities (no embeddings, no tools, no images). Orchestration that switches on vendor names (`if vertex`) does not extend.

## Decision

- Split providers: `ModelProvider`, `EmbeddingProvider`, `RerankerProvider`, `ExtractionProvider`, `AgentRuntimeProvider`.
- Ship **`plugins/model-vertex`** as the **first-class** implementation for generate, structured extraction, and embeddings where Vertex supports them.
- Other vendors are plugins with the same interfaces. Orchestration selects by **capability descriptors** (`tools`, `structuredOutput`, `embeddings`, `maxContextTokens`, …), not by vendor string.
- Kernel and capability packs never import `@google-cloud/aiplatform` or vendor SDKs.
- Standalone may bind a local or non-Vertex plugin; enterprise GCP defaults to Vertex (ADC / workload identity).
- Kotowari is not a model gateway; it does not become a general-purpose LLM proxy.

## Consequences

**Positive**

- GCP production path is native (IAM, audit, regional models).
- Individuals are not forced through Vertex.
- New vendors are contract-tested plugins.
- Extraction can be a non-LLM plugin (pattern/ML) with the same `ExtractionProvider` port.

**Negative**

- Vertex-specific features (certain safety filters, grounding) must be expressed as optional capability flags or they will leak into core.
- Dual-running Vertex + OpenRouter increases config surface.
- Embedding dimension/model changes require re-projection jobs.

## Alternatives considered

- **LiteLLM-in-core as the only interface:** convenient, hides capability gaps, another critical dependency.
- **OpenAI-only:** mismatches GCP enterprise default.
- **Vendor names in retrieval/ingest code:** rejected.
- **In-house model gateway product:** out of scope.
