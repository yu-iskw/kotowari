# Commercial UI agent tooling

This repository carries a small, auditable UI/UX agent stack for Cursor and Claude Code. The goal is commercial-grade UI work with explicit design direction, production engineering constraints, accessibility, and browser verification rather than a large collection of overlapping skills.

## Installed

| Capability | Integration | Pinned source |
| --- | --- | --- |
| Distinctive visual direction | Claude Code `frontend-design` plugin | `anthropics/claude-code@c3d2e35e554060b5a20ee6b28140fbdbd4eb0048`, subdir `plugins/frontend-design` |
| UI critique/polish | Claude Code `impeccable` plugin | `pbakaus/impeccable@f88b2837a7d7c3182e46307bbbb091a1ed547571`, subdir `plugin` |
| Focused UI craft skills | Claude Code `ui-skills` plugin | `ibelick/ui-skills@0a8411b1f8732d52923e78773d54b67a65ef9587` |
| Production frontend engineering | Project skill `frontend-ui-engineering` | Adapted from `addyosmani/agent-skills@df1edb2e05487d0aa6d93c747141e0aed1187f25`; MIT notice in `.claude/third_party/addy-agent-skills.LICENSE` |
| Repository-specific orchestration | Project skill `commercial-ui` | Maintained in this repository |
| Browser inspection | Cursor project MCP | `@playwright/mcp@0.0.78` in `.cursor/mcp.json` |
| Automatic Cursor guidance | Cursor project rule | `.cursor/rules/commercial-ui.mdc` |

The existing `.agents/skills` symlink exposes project skills under `.claude/skills` to agents that support the Agent Skills convention, including Cursor. Claude Code additionally installs the pinned plugins declared in `.claude/settings.json`; trust/installation prompts remain user-controlled.

## Workflow

For a UI task:

1. Establish the surface's audience, job, product terminology, constraints, and incumbent visual truth.
2. Use `commercial-ui` as the repository workflow and `frontend-ui-engineering` as the implementation quality floor.
3. For a new visual direction or substantial redesign, use `frontend-design`; use Impeccable/UI Skills for critique and polish when running Claude Code.
4. Implement with semantic HTML, coherent tokens/primitives, realistic states, keyboard/focus behavior, responsive reflow, and accessibility as acceptance criteria.
5. If a runnable browser surface exists, use the Playwright MCP for a bounded desktop+mobile inspection, fix findings as one batch, and perform at most one confirmation pass. Never claim a visual check that was not actually run.

## Kotowari-specific constraint

`apps/web` is currently a framework-neutral TypeScript package scaffold rather than a React application. Do not introduce React, Next.js, Tailwind, shadcn/ui, or another framework/component system merely because an agent tool supports it. Framework adoption should be an explicit architecture decision based on the product surface being built.

Consequently, the following previously considered tools are intentionally **not installed yet**:

- Vercel React best-practices skill: valuable after React/Next.js adoption, currently a stack mismatch.
- shadcn/ui Cursor plugin/MCP: valuable after a shadcn-compatible React UI/design-system decision, currently a stack mismatch.
- Cursor Design Mode: native Cursor functionality rather than repository-installable configuration; use it when available for element-level visual feedback.

## Updating pins

Treat agent instructions and MCP packages as executable development dependencies. Upgrade one source at a time, review its skill/plugin diff and license, run relevant repository checks, and update this file with the new commit or package version. Do not replace these pins with mutable `main` or `latest` references without an explicit reason.

## Verification commands

Cursor can show project MCP status with:

```bash
cursor-agent mcp list
```

For repository changes, continue to use the canonical build/lint/test commands documented in `AGENTS.md`. Browser verification is only applicable once the target has a runnable UI.
