---
name: search-memory
description: Decide when to search Kotowari memory vs search knowledge, record a decision, or ingest sources. Use before answering from prior sessions or workspace facts.
---

# Search memory and knowledge

## When to use each tool

| Situation | Tool |
| --- | --- |
| Facts from ingested documents, claims, or evidence | `search_knowledge` |
| Prior agent notes, scratch context, or session memory in the workspace namespace | `search_memory` |
| User chose an outcome, policy, or precedent to persist | `record_decision` |
| New files or folders must be added to the workspace | `ingest_path` |

## Search knowledge first for sourced facts

Use `search_knowledge` when the user asks what the workspace **knows** from ingested material — vendor status, policy text, personnel changes, architecture notes. Prefer knowledge hits that cite evidence ids and explain why they were selected.

## Search memory for agent continuity

Use `search_memory` when you need what **you or another agent already recorded** in memory — preferences, interim conclusions, task state, or namespace-scoped scratch that is not yet published as knowledge.

Do not substitute memory for evidence-backed claims when the user expects sources.

## Record decisions explicitly

Call `record_decision` when the user confirms a choice, approves a plan, or asks to remember a decision for audit or precedents. Attach a context snapshot when available and list evidence ids you considered.

Never infer a decision from a completion alone; the platform stores decisions only when this tool is called.

## Ingest before first query

If the workspace may be empty or the user references files not yet indexed, call `ingest_path` before searching. Empty knowledge results after ingest warrant telling the user what was ingested and suggesting a narrower query.

## Least privilege

The retrieve MCP profile exposes search, memory, decision, and scoped ingest tools only. Admin and unrestricted ingestion tools are not available in this plugin profile.
