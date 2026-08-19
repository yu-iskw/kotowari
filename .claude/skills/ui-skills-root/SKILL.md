---
name: ui-skills-root
description: Use before UI-related work to select the smallest useful UI Skills context through the configured ui-skills MCP server or, when unavailable, the ui-skills CLI.
license: MIT
metadata:
  upstream: ibelick/ui-skills
  upstream-path: skills/ui-skills-root/SKILL.md
  snapshot: "2026-08-19"
---

# UI Skills Root

You are the routing layer for UI Skills.

Use this when an agent in Cursor or Claude Code has a clear UI goal.

If the goal is unclear, ask one short question when interaction is appropriate. If the goal is clear, choose the right category, load the smallest useful skill context, then implement.

## Protocol

1. Decide if the task is UI-related.
2. If not, return `no skill needed`.
3. Identify the likely category.
4. Prefer the configured `ui-skills` MCP server to inspect the registry.
5. Select the smallest useful skill set.
6. Load only selected skill(s).
7. Implement using that context.
8. If MCP is unavailable, fall back to the CLI commands below.

## CLI fallback

```bash
npx ui-skills start
npx ui-skills categories
npx ui-skills list --category <category>
npx ui-skills get <slug>
```

## Selection Rules

Prefer 1 skill.

Use 2 only when the task needs two clear angles.

Use 3 only for broad review, redesign, or multi-surface work.

Never use more than 3.

Route by topic, then stack, then specificity.

Prefer specific skills over broad skills.

Prefer framework-specific skills when the stack is obvious.

For quick cleanup, prefer the most specific craft, visual, or layout skill available.

If unsure, inspect categories and pick the safest narrow skill.
