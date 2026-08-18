---
name: record-decision
description: Record an explicit decision with selectedOutcome, rationale, and a context snapshot. Use when the user confirms a choice or asks to save a precedent.
---

# Record decision

`record_decision` is part of the default standalone `personal` MCP preset, so an individual user gets decision recording from the same local Kotowari MCP server used for knowledge and memory. Enterprise deployments continue to expose decision writes through the independently scoped `decision-write` HTTP profile.

## When to record

Call `record_decision` when:

- The user explicitly chooses an option.
- The user asks to remember a decision for audit, compliance, or future precedents.
- A high-stakes flow ends with a committed outcome, not just a draft answer.

Do **not** call this tool for exploratory reasoning, tentative suggestions, or internal chain-of-thought.

## Required payload

- **selectedOutcome** — short label for the selected outcome (required).
- **purpose** — why this decision is being recorded.
- **query** — question used to assemble the context snapshot.
- **rationale** — brief user-facing reason (not hidden chain-of-thought).
- **alternatives** — other outcomes you considered.
- **confidence** — 0–1 confidence in the outcome.

## Workflow

1. Search knowledge (`search_knowledge`) to gather sourced facts.
2. Optionally search memory (`search_memory`) for prior agent context.
3. Present options to the user when the choice is not already explicit.
4. After confirmation, call `record_decision` with `selectedOutcome` and all relevant alternatives.
5. Tell the user the decision was recorded.

Never persist hidden chain-of-thought.
