---
name: search-memory
description: Decide when to search Kotowari memory vs search knowledge or record a decision. Use before answering from prior sessions or workspace facts.
---

# Search memory and knowledge

## When to use each tool

| Situation                                              | Tool               |
| ------------------------------------------------------ | ------------------ |
| Facts from ingested documents, claims, or evidence     | `search_knowledge` |
| Prior agent notes, scratch context, or session memory  | `search_memory`    |
| User chose an outcome, policy, or precedent to persist | `record_decision`  |

## Search knowledge first for sourced facts

Use `search_knowledge` with `query` (required) and optional `purpose`. Prefer hits that cite evidence ids and explain why they were selected.

## Search memory for agent continuity

Use `search_memory` when you need what you or another agent already recorded in memory. Do not substitute memory for evidence-backed claims when the user expects sources.

## Record decisions explicitly

Call `record_decision` with `selectedOutcome` (required) when the user confirms a choice. Never infer a decision from a completion alone.

## Least privilege

The retrieve MCP profile exposes search, memory, and decision tools only. Admin and ingestion tools are not available in this plugin profile.
