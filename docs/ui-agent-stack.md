# UI Agent Stack

This repository carries a small, auditable UI/UX agent stack for work in `apps/web`. The goal is commercial-grade product UI without making a frontend-framework decision implicitly.

## Installed capabilities

| Capability | Integration | Scope | Notes |
| --- | --- | --- | --- |
| Anthropic `frontend-design` | Vendored Agent Skill | Cursor + Claude Code | Snapshot from `anthropics/claude-plugins-official`; used for deliberate visual direction and anti-template design review. |
| Addy Osmani `frontend-ui-engineering` | Vendored Agent Skill | Cursor + Claude Code | Snapshot from `addyosmani/agent-skills`; used for production UI structure, responsiveness, state handling, and accessibility. |
| `ui-skills-root` | Adapted Agent Skill + remote MCP | Cursor + Claude Code | Routes narrow design questions to the `ui-skills` registry; prefer one specialist skill and never more than three. |
| Impeccable | Claude Code project plugin | Claude Code | Declared through `.claude/settings.json` using the `pbakaus/impeccable` marketplace. Claude Code will apply its normal repository-trust/plugin-install consent flow. |
| Playwright MCP | Project MCP server | Cursor + Claude Code | Pinned to `@playwright/mcp@0.0.79` and launched with `--isolated` so browser profile state is not persisted between sessions. |
| Cursor Design Mode | Built into Cursor | Cursor | No repository installation is required; use it for region-level visual feedback when working interactively. |
| UI quality rule | `.cursor/rules/ui-quality.mdc` | Cursor | Auto-attaches to `apps/web/**/*` and defines the design → implementation → rendered-verification workflow. |

Cursor discovers compatible Agent Skills from `.claude/skills`, so the checked-in skills intentionally have a single source of truth instead of duplicate `.cursor/skills` copies.

## Standard workflow

For substantial UI work:

1. Understand the target user, primary task, important information hierarchy, and required states.
2. Use `frontend-design` to establish a deliberate visual direction before coding.
3. Use `frontend-ui-engineering` to implement the design using the repository's actual stack.
4. Query `ui-skills` only when a narrower design-engineering specialty would materially help.
5. In Claude Code, optionally run an Impeccable critique/polish pass.
6. Run the application and use Playwright MCP to exercise the rendered UI.
7. Check representative desktop, tablet, and mobile widths; keyboard/focus behavior; reduced motion; loading/empty/error states; long content; overflow; console errors; and destructive/disabled states.
8. Use Cursor Design Mode for human visual annotations, then repeat browser verification after fixes.

A source-only review is not sufficient evidence that a UI change is production-ready.

## Deliberately deferred

### shadcn/ui Cursor plugin

Not installed because Kotowari's current `apps/web` package is a framework-neutral TypeScript scaffold and does not currently depend on React. Introducing React or a component framework is an architectural decision and should not happen as a side effect of agent tooling.

### Vercel React best-practices skill

Not installed for the same reason. Add it when the web architecture actually adopts React/Next.js.

### Impeccable in Cursor

Cursor does not currently offer a repository-file-based, non-interactive way to install an arbitrary marketplace plugin into every collaborator's workspace. The repository therefore does not claim that the Cursor Impeccable plugin is installed. The checked-in design skills, UI Skills MCP, Playwright MCP, and UI quality rule provide the default Cursor workflow; an individual developer may additionally install Impeccable through Cursor's interactive plugin/skill workflow.

## Security and maintenance

- Keep third-party Agent Skills small and reviewable; do not add bulk skill collections.
- The Cursor sandbox remains default-deny. Only `registry.npmjs.org` and `www.ui-skills.com` were added for the configured UI tooling.
- Playwright MCP runs with isolated browser profile state by default.
- Project MCP files contain no credentials.
- Review upstream skill changes before refreshing vendored snapshots.
- Reconsider shadcn and React-specific skills only after a deliberate frontend architecture decision.

## Provenance

- `frontend-design`: `anthropics/claude-plugins-official`, `plugins/frontend-design/skills/frontend-design/SKILL.md`, upstream blob `decdff43d05908b4c1fc2cfd2d80fc5743440934`, Apache-2.0.
- `frontend-ui-engineering`: `addyosmani/agent-skills`, `skills/frontend-ui-engineering/SKILL.md`, upstream blob `837df875900d4d431c6d51a3251bac0d4bd5dfed`, MIT.
- `ui-skills-root`: adapted from `ibelick/ui-skills`, `skills/ui-skills-root/SKILL.md`, upstream blob `c40d8458a67aa859d4ce50589d22f36f14123fb9`, MIT.
- Impeccable marketplace observed at version `4.1.1` when this stack was added.
- Playwright MCP package observed at version `0.0.79` when this stack was added.

The repository root `LICENSE` supplies the Apache License 2.0 text used by the Anthropic skill. The MIT notices required by the vendored/adapted skills are reproduced below.

### Addy Osmani Agent Skills — MIT License

MIT License

Copyright (c) 2025 Addy Osmani

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

### UI Skills — MIT License

MIT License

Copyright (c) 2026 Julien Thibeaut

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
