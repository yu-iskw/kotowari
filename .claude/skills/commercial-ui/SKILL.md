---
name: commercial-ui
description: Use when designing, implementing, reviewing, or polishing a user-facing Kotowari interface. Orchestrates visual direction, production frontend engineering, accessibility, responsive behavior, and rendered verification without inventing a frontend framework.
---

# Commercial UI workflow for Kotowari

Use this workflow for UI work under `apps/web/` or any future browser-facing Kotowari surface.

## 1. Establish product truth before aesthetics

Read the relevant product/RFC documentation and the incumbent UI code first. State the surface's audience and single primary job. Preserve existing product terminology, permissions, data semantics, and workflows.

If a new visual direction is required, use the installed `frontend-design` and `impeccable` Claude plugins when available. Otherwise make a compact design plan covering semantic color tokens, typography roles, spacing/density, information hierarchy, interaction states, and one justified signature element. Avoid generic AI defaults such as arbitrary gradients, oversized cards, excessive rounding, decorative statistics, or uniform card grids that ignore information priority.

## 2. Engineer the UI, do not merely style it

Use the project `frontend-ui-engineering` skill as the implementation quality floor. Prefer semantic HTML and native controls. Reuse existing primitives and tokens before creating new ones. Keep data and domain logic separate from presentation.

Every interactive surface must cover loading, empty, error, disabled, success, and destructive states when those states can occur. User-visible actions and status messages must use consistent terminology.

Do not introduce React, Next.js, shadcn/ui, Tailwind, or another frontend framework/design system merely to satisfy this workflow. `apps/web` is currently a framework-neutral scaffold; adopting a UI framework is a separate architectural decision.

## 3. Accessibility and responsive behavior are acceptance criteria

At minimum verify keyboard access, visible focus, semantic headings/landmarks, form labels, meaningful accessible names, contrast, non-color-only state communication, touch targets, reduced-motion behavior when animation exists, and zoom/reflow. Use `.claude/references/accessibility-checklist.md` for the detailed checklist.

For browser UI, explicitly inspect representative phone, tablet, laptop, and wide desktop widths rather than assuming responsiveness from CSS alone.

## 4. Verify rendered behavior when a runnable UI exists

Use the project Playwright MCP from `.cursor/mcp.json` when working in Cursor. Run the repository's normal tests/build first, then inspect the rendered surface in one bounded desktop+mobile pass. Exercise primary interactions, keyboard navigation, empty/error states that can be reached safely, console errors, overflow, clipping, and unintended layout shifts. Fix findings as one batch and perform at most one confirmation pass.

If the target is still only the current `apps/web` package scaffold and has no runnable browser UI, do not fabricate screenshots or pretend browser verification occurred. Report that rendered verification becomes applicable when a runnable surface is introduced.

## 5. Completion standard

A UI task is complete only when it preserves product behavior, follows a coherent design system, is accessible and responsive, has meaningful state handling, passes relevant repository checks, and—when runnable—has been inspected in the browser. Report what was actually verified and any verification that was not applicable.
