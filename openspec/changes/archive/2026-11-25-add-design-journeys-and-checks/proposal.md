# Proposal

## Why

After the foundation, the agent can draw clickable screens but cannot prove that a flow works or that a layout holds at every breakpoint without a human looking. Deterministic, fast checks over the real render let the agent validate its own work before showing it, which is what makes the loop fast.

## What Changes

- Declared screen state: named states a screen can start in (for example, a drawer open with a filter chosen), addressable from the preview URL and from tools.
- Fixtures: fictitious mock data in `design/fixtures/` (JSON), and binding of lists, tables, and selects to fixture collections through an item template, without general logic.
- User journeys in `design/journeys/`: a restricted JSX-style script of steps (tap, type, choose, navigate) and assertions (screen shown, node visible or hidden, value, count).
- A headless Chromium kept warm per session, rendering in deterministic mode, reusing DSH's per-session browser lifecycle pattern.
- New tools: `design_run_journey` (per-step results, semantic snapshot at the failing step), `design_lint` (overflow, overlap, clipped text, tap targets under 44 px, off-token values, at every breakpoint), `design_screenshot` (screen, state, breakpoint, optional node highlight; on demand only), and `design_query` (find nodes by component, prop, or ID pattern).
- `design_view` gains computed layout boxes per breakpoint from the headless render (the semantic snapshot).
- Accessibility checks are out of scope.

## Capabilities

### New Capabilities

- `design-state-and-fixtures`: named screen states, fixture files, and data binding of collection components.
- `design-journeys`: the journey file format, its steps and assertions, and journey execution semantics.
- `design-headless-checks`: the warm headless renderer, layout lint rules, screenshots, and layout snapshots.

### Modified Capabilities

- `design-dsl`: state declarations, fixture references, item templates, and journey syntax.
- `design-agent-tools`: the new tools and layout boxes in `design_view`.
- `design-agent-preset`: guidance to run journeys and lint before reporting, and to use screenshots sparingly.
- `design-preview-server`: opening a screen in a named state from the URL.

## Impact

- Adds a headless Chromium dependency and per-session browser processes (memory and startup cost; closed with the session).
- Builds on the kit's deterministic mode and semantic attributes from the foundation.
- Fixtures must stay fictitious; the preset guidance and scaffolded examples say so explicitly.
