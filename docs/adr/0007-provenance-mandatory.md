# ADR-0007: Provenance is mandatory; compact internal schema; PROV-O at the boundary

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Kotowari architecture

## Context

Accountability is the product. Optional provenance becomes missing provenance. W3C PROV-O is the right *interoperability* model for export to compliance tooling, but forcing RDF triples through every write makes the kernel unusable and couples SQL-canonical records to semantic-web stacks.

Semantica treats PROV-O as core and warns that whole-graph snapshots are not a substitute for granular lineage. Kotowari agrees with the principle and disagrees with RDF-on-the-hot-path.

## Decision

- **Every semantic write** (claim assert/retract, evidence insert, entity merge, decision record, policy evaluation, conflict resolution) **must** attach provenance. The kernel **rejects** writes without it.
- **Internal schema (compact):** `source`, `sourceVersion`, `actor`, `process`, `model`, `promptVersion`, `extractorVersion`, `timestamp`, `parentIds[]`.
- **Export:** PROV-O / JSON-LD / RDF at the boundary (`capability-provenance` exporter). Internal APIs do not require callers to speak PROV-O.
- Whole-graph snapshots are optional operational backups, not the audit mechanism.
- Retrieval and decision views always offer a path back to evidence + provenance.

## Consequences

**Positive**

- Audit and replay do not depend on log aggregation luck.
- Re-extraction can cite extractor versions.
- Compliance export is a projection, like RDF of claims.

**Negative**

- Write path is stricter; sloppy importers fail closed.
- Compact schema may need additive fields; version the provenance record, do not silently drop history.
- Export mapping to PROV-O must be tested or interoperability is theater.

## Alternatives considered

- **Opt-in provenance:** rejected; it will be skipped.
- **PROV-O on every internal operation:** rejected; RDF is an export concern.
- **Snapshot-only versioning:** rejected as the sole audit trail; too coarse and expensive.
