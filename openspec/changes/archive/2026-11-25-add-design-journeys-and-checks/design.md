# Design

## Context

The foundation already normalizes restricted JSX in core, loads projects incrementally, exposes owner-only previews, and sends a self-contained deterministic document with inlined assets and a fixed render clock. The interactive renderer has a reactive route store, stable node attributes, and per-session interaction state. Host tools currently see the static validated tree. A browser regression suite uses Chromium through Playwright; the runtime bundle builds a separate host program.

## Goals / Non-Goals

**Goals:** Share one validated representation and one kit between interactive preview and browser tools. Keep ordinary text inspection available without Chromium. Make checks deterministic within the same pinned browser environment, bounded, cancellable, and isolated from the real app and browser profile.

**Non-Goals:** Arbitrary browser scripts/selectors, general state machines or conditions, live app connections, accessibility audits, visual baselines, automatic screenshots, or a GUI test runner.

## Decisions

### D1. Named initial state is screen metadata

Reserve a literal `states` prop on Screen: each kebab-case key maps to an object with optional `open` (overlay IDs), `tabs` (Tabs ID to tab value), and `values` (input ID to compatible scalar or string-array value). Validate each declaration against the expanded screen and strip the metadata from renderable props. Carry only validated states with the screen's validated tree; during invalid edits keep the last valid state definitions with that tree. Apply the seed once per screen/state route transition, including direct links and browser history; a breakpoint change does not reseed. Hot reload reconciles against surviving IDs and does not override interaction. Entering another screen without a state clears the route's state parameter. Unqualified URLs retain the original defaults. Route and tool errors for unknown states are explicit.

### D2. Fixture bindings are normalized before rendering

Use optional `fixtures/<id>.json` files containing arrays of flat objects with a unique kebab-case `id` and bounded scalar fields. Use `items={fixture("orders")}` on List with one `ItemTemplate` child, supporting `{item("field")}` on literal-safe props and text inside the template; use `rows={fixture("orders")}` with Table's declared columns, and `options={fixture("plans")}` with `id` and `label` on option records. Normalize these into existing kit primitives on the host. One shared validator enforces field/prop types, duplicate keys, local project confinement, finite fixture and expansion budgets, and no execution. Bindings used by lists SHALL NOT supply node IDs, interaction expressions, CSS, or URLs. Derive repeated child IDs/addresses from the List ID, fixture key and template node identity, never array position, with deterministic collision validation. Static query, initial states, journey actions, and browser snapshots use the normalized tree. Avoid a second renderer or JS interpolation engine because either would produce a different contract than the preview.

### D3. Journeys are typed data, not browser programs

Parse `journeys/<file>.dsx` with a distinct Journey root containing `id`, `start`, optional `state`, optional `breakpoint`, and children `Tap target`, `Type target value`, `Choose target value`, `Navigate screen`, `ExpectScreen screen`, `ExpectVisible target visible`, `ExpectValue target value`, and `ExpectCount target count` (visible occurrences of the declared target). Stable IDs are resolved only within the current canvas; navigation targets are screen IDs, not URLs. Static validation checks statically knowable references, types, and duplicates; live actions still verify the active screen and target. Use real controls for tap/type/choose, wait for the renderer's committed state, and abort on the first failed step. Distinguish a failed assertion from invalid DSL or a browser infrastructure failure; avoid timing values in deterministic result bodies.

### D4. Use the existing deterministic document in an isolated runtime

Reuse the same document builder and a validated immutable payload for a tool invocation, including the allowed inline passive media; no credential, owner HTTP route, or actual app URL is needed. In a fresh isolated browser context bind a synthetic local origin and serve only that in-memory HTML as its one document; reject further network access and block service workers. Use the project's breakpoint width and a documented fixed browser viewport height, with fixed scale, locale and time zone. Wait for validated canvas and fonts rather than arbitrary sleeps. Keep one lazily launched Chromium per active DSH session and serialize its work; independent sessions can run concurrently with a bounded pool and clean contexts. Handle cancellation, timeouts, broken process recovery and disposal on `session/disposed` and plugin shutdown. Reuse the existing Playwright dependency as a runtime dependency in the packed install and support an operator-configured Chromium path or a matching installed browser. Do not disable browser isolation, auto-download a browser, or require a Chromium installation for preview and static tools.

### D5. Geometry and tool output

Read rendered node IDs, visibility, accessible role/name where available, and canvas-relative boxes from the DOM using stable DOM order and documented rounding. Keep this snapshot small and cap queries by depth, subtree and item count as appropriate. Match overflow and clipping against actual scroll/clip containers, use peer intersections (not ancestor/descendant and not modal backdrops), and apply the 44px minimum to actual pointer targets rather than wrappers. Report screen, breakpoint, rule, node identifiers and observed dimensions with deterministic ordering. Add `design_run_journey`, `design_lint`, `design_screenshot`, and `design_query`. Extend `design_view` with an explicit breakpoint argument (otherwise no browser) and optional named state, and include fixtures and journeys in appropriate project/file/screen validation and automatic edit diagnostics. Query supports exact component, exact scalar prop and ID glob with only `*` and `?`. Screenshot the canvas only, add optional temporary target outline, generate a deterministic cache-relative PNG name from the snapshot and capture parameters, and return a path the same session can inspect. Use canonical confinement, bounded output, and atomic writes under the ignored `.cache/`. Never put screenshots in tracked sources or silently emit partial output.

## Risks / Trade-offs

- Raw CSS makes layout intent unknowable. Report geometric evidence and documented exclusions rather than judging appearance.
- Font/browser differences can alter computed layout. Reproducibility means the same project, arguments, and browser/runtime environment, not cross-platform pixel identity.
- A new browser package can work in a workspace and fail after installation. Test the actual packed tarball in a clean DSH profile, without resolving workspace dependencies by accident.
- Fixtures and browser operations can grow large. Bound input, render complexity, captures, process count, and execution times; make limit failures explicit.

## Migration Plan

Existing designs without states, fixtures, or journeys continue to work. Projects can add the optional directories without a migration. Chromium-backed tools clearly explain what to install or configure if Chromium is unavailable.
