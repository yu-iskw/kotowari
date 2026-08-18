# ADR-0002: SQL-canonical knowledge; graph, vector, RDF as projections

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Kotowari architecture

## Context

Semantica treats swappable graph and vector stores as a first-class architectural property. That breadth is useful for a library that must sit on whatever the customer already runs. For a greenfield internal platform it multiplies operational combinations, AI-coding complexity, and the risk that “the graph” and “the claims table” diverge.

The product’s unit of belief is a **Claim** (bitemporal, evidenced, namespaced), not an LPG edge. Graphs, embeddings, FTS, and RDF are ways to _look at_ claims. AlloyDB / PostgreSQL pgvector makes a SQL-first enterprise backend viable without a dedicated vector database on day one.

## Decision

- **Canonical store:** SQLite (standalone) and PostgreSQL or AlloyDB (enterprise) hold entities, claims, evidence metadata, decisions, policies, and provenance.
- **Projections:** vector index (sqlite extension / pgvector), FTS, application-level or recursive-SQL graph traversal, generated RDF/JSON-LD. Optional Neo4j/Neptune/search indexes are **projection workers** fed from domain events.
- Introduce a dedicated graph database only after measurement shows SQL is inadequate (deep recursion, large graph algorithms, high-rate traversal, mandated Cypher/SPARQL clients).
- Losing a projection is recoverable by replay. Losing canonical SQL is not.

## Consequences

**Positive**

- One source of truth for conflicts, tenancy, bitemporality, and audit.
- Standalone and enterprise share semantics; physical engines differ.
- Operational surface for v1 is SQLite or Postgres, not Neo4j + Pinecone + Blazegraph.
- Re-embedding and re-projection do not require re-ingestion from SaaS if evidence blobs remain.

**Negative**

- Very large hop-depth traversals may be slower until a graph projection exists.
- SPARQL-native users wait on an export/projection, not a primary triple store.
- Projection lag must be documented (eventual consistency of Neo4j, etc.).

## Alternatives considered

- **Graph database as canonical store:** strong traversal, weak fit for tenancy, bitemporal claims, and cheap standalone.
- **Semantica-style many equal backends:** defer; optional plugins later.
- **Event-source everything and fold on read:** too heavy for config/UI; we event-source _semantic_ changes only.
