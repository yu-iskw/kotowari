# ADR-0008: Decisions are first-class records, not log lines

- **Status:** Accepted
- **Date:** 2026-08-17
- **Deciders:** Kotowari architecture

## Context

Agents and humans make consequential choices that vanish into chat logs. Semantica’s strongest product idea is the decision as a graph object with precedents, causal links, policy checks, and audit export. Kotowari must keep that idea without treating “the LLM’s private chain-of-thought” as explainability.

System-level explainability: context fed in, evidence, policies, selected outcome, actions, observed result. Foundation-model internals stay opaque.

## Decision

A **Decision** is a canonical domain record:

- `inputContextSnapshot`
- `consideredEvidence[]`
- `applicablePolicies[]`
- `selectedOutcome`
- `alternatives[]`
- `confidence`
- `actor` (human or agent principal)
- `model` / runtime identifiers (not CoT)
- `resultingActions[]`
- optional `observedOutcome`

Product operations: record, find precedents, causal/influence links, policy evaluate, exception/approval chain, export.

Do **not** persist hidden chain-of-thought. Persist observable justification (evidence, tool calls, policy results, actor-authored rationale).

Logs remain for ops; they are not the decision store.

## Consequences

**Positive**

- Precedent search and regulatory export have a stable object.
- Context snapshots answer “what did it know at the time?”
- Policy versions can be re-applied in what-if and re-audit flows.

**Negative**

- Snapshots cost storage; retention policies are required (especially memory vs knowledge).
- Agents must be prompted/tooled to call `record_decision`; the platform cannot infer a decision from a completion.
- Causal graphs can be misused; links must be explicit, not guessed from timestamps alone.

## Alternatives considered

- **Structured logs / OpenTelemetry only:** not queryable as organizational knowledge.
- **Persist full model CoT:** rejected (opacity, leakage, false explainability).
- **Decisions only in the LPG projection:** rejected; canonical SQL/kernel record first.
