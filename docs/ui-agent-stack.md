# UI Agent Stack

This repository carries a small, auditable UI/UX agent stack for work in `apps/web`.
The goal is commercial-grade product UI without making a frontend-framework decision implicitly.

## Installed capabilities

- **Anthropic `frontend-design`**: a vendored Agent Skill for deliberate visual direction and
  anti-template design review. It is usable by Cursor and Claude Code.
- **Addy Osmani `frontend-ui-engineering`**: a vendored Agent Skill for production UI structure,
  responsiveness, state handling, and accessibility. It is usable by Cursor and Claude Code.
- **`ui-skills-root`**: an adapted routing skill that prefers the configured UI Skills MCP registry
  for narrow design-engineering guidance.
- **Impeccable**: declared as a Claude Code project plugin through `.claude/settings.json`.
  Claude Code retains its normal repository-trust and plugin-install consent flow.
- **Playwright MCP**: configured for Cursor and Claude Code, pinned to
  `@playwright/mcp@0.0.79`, and launched with `--isolated` browser state.
- **Cursor Design Mode**: built into Cursor and available for interactive visual feedback.
- **UI quality rule**: `.cursor/rules/ui-quality.mdc` applies to `apps/web/**/*` and requires a
  design, implementation, rendered-verification, and correction loop.

Cursor discovers compatible Agent Skills from `.claude/skills`, so the checked-in skills keep one
source of truth rather than duplicate `.cursor/skills` copies.

## Standard workflow

For substantial UI work:

1. Understand the target user, primary task, information hierarchy, and required states.
2. Use `frontend-design` to establish a deliberate visual direction before coding.
3. Use `frontend-ui-engineering` to implement the design with the repository's actual stack.
4. Query `ui-skills` only when a narrower design-engineering specialty would materially help.
5. In Claude Code, optionally run an Impeccable critique or polish pass.
6. Run the application and use Playwright MCP to exercise the rendered UI.
7. Check desktop, tablet, and mobile widths; keyboard and focus behavior; reduced motion;
   loading, empty, and error states; long content; overflow; console errors; and disabled or
   destructive states.
8. Use Cursor Design Mode for human visual annotations, then repeat browser verification.

A source-only review is not sufficient evidence that a UI change is production-ready.

## Third-party snapshot policy

The three imported skill snapshots are intentionally excluded from repository Prettier and
markdownlint rewriting. `.prettierignore` and `.markdownlint-cli2.yaml` list those paths explicitly.
This keeps upstream refreshes reviewable and avoids creating local-only formatting deltas inside
third-party instructions.

Repository-owned configuration and documentation remain subject to the normal formatting and lint
checks.

## Deliberately deferred

### shadcn/ui Cursor plugin

It is not installed because Kotowari's current `apps/web` package is a framework-neutral TypeScript
scaffold and does not depend on React. A component framework should follow an explicit frontend
architecture decision rather than arrive as a side effect of agent tooling.

### Vercel React best-practices skill

It is not installed for the same reason. Add it only after the web architecture adopts React or
Next.js.

### Impeccable in Cursor

The repository does not claim that the Cursor Impeccable plugin is installed for every developer.
The checked-in design skills, UI Skills MCP, Playwright MCP, and UI quality rule form the default
Cursor workflow. Developers may additionally install Impeccable through Cursor's interactive
plugin or skill workflow.

## Security and maintenance

- Keep third-party Agent Skills small and reviewable; do not add bulk skill collections.
- Keep the Cursor sandbox default-deny. The UI stack only adds the network destinations it needs.
- Keep Playwright MCP on isolated browser state unless persistent state is deliberately required.
- Do not place credentials in project MCP configuration.
- Review upstream changes before refreshing vendored skill snapshots.
- Reconsider shadcn and React-specific skills only after a deliberate frontend architecture choice.

## Provenance

- `frontend-design`: `anthropics/claude-plugins-official`, upstream path
  `plugins/frontend-design/skills/frontend-design/SKILL.md`, snapshot blob
  `decdff43d05908b4c1fc2cfd2d80fc5743440934`, Apache-2.0.
- `frontend-ui-engineering`: `addyosmani/agent-skills`, upstream path
  `skills/frontend-ui-engineering/SKILL.md`, snapshot blob
  `837df875900d4d431c6d51a3251bac0d4bd5dfed`, MIT.
- `ui-skills-root`: adapted from `ibelick/ui-skills`, upstream path
  `skills/ui-skills-root/SKILL.md`, snapshot blob
  `c40d8458a67aa859d4ce50589d22f36f14123fb9`, MIT.
- Impeccable marketplace version observed when this stack was added: `4.1.1`.
- Playwright MCP package version observed when this stack was added: `0.0.79`.

The repository root `LICENSE` contains the Apache License 2.0 text. MIT notices for the vendored or
adapted skills are kept beside the relevant skill as `LICENSE.txt`.
