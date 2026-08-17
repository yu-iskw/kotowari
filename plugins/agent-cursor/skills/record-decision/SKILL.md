---
name: record-decision
description: Record an explicit decision with outcome, rationale, context snapshot, and considered evidence. Use when the user confirms a choice or asks to save a precedent.
---

# Record decision

## When to record

Call `record_decision` when:

- The user explicitly chooses an option ("go with vendor A", "approve the migration").
- The user asks to remember a decision for audit, compliance, or future precedents.
- A high-stakes flow ends with a committed outcome, not just a draft answer.

Do **not** call this tool for exploratory reasoning, tentative suggestions, or internal chain-of-thought.

## Required payload

- **outcome** — short label for the selected outcome (required).
- **rationale** — brief user-facing reason (not hidden chain-of-thought).
- **contextSnapshotId** — when you built context via Kotowari for this task.
- **consideredEvidenceIds** — evidence ids from `search_knowledge` hits you weighed.
- **alternatives** — other outcomes you considered.
- **confidence** — 0–1 confidence in the outcome.

## Workflow

1. Search knowledge (`search_knowledge`) to gather sourced facts.
2. Optionally search memory (`search_memory`) for prior agent context.
3. Present options to the user when the choice is not already explicit.
4. After confirmation, call `record_decision` with outcome and provenance fields.
5. Tell the user the decision was recorded and how to find precedents later.

## After recording

Future sessions can use `search_knowledge` or dedicated precedent flows to find prior decisions. Link new work to the same namespace when the decision applies to an ongoing case.
