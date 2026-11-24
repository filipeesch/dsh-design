# Design

## Context

See proposal.md for motivation and specs/ for the required behavior. This repository is greenfield (only OpenSpec scaffolding). Facts observed in the DSH checkout that shape the approach:

- Tools are registered with `ctx.tools.register(defineTool(...))`; arguments are schema-validated, results are canonical JSON with a separate human rendering, and tools are reachable from programmatic tool calling for free.
- `ctx.webServer.register(route)` accepts `exact` and `prefix` HTTP routes. Admission defaults to `required` (a live owner Peer); upgrade (WebSocket) routes match exact paths only.
- The tool pipeline is `tools/pre-execute` -> guards -> `tools/execute` (around-dispatch wrapper with one lexical lifetime) -> `tools/post-execute` (may attach model-facing context) -> `tools/result`.
- Agent presets are declarative Cordis YAML: a preset is an ID plus a list of child plugin entries, selected per session.
- `dsh plugin` forwards to pnpm in the profile directory, so any pnpm-resolvable package (including `link:` and `file:` paths) can be installed. A client plugin declares `dsh.client` in its package.json and exports `./client`.
- Typed host-to-client Remotes are generated when DSH itself is built, so an external plugin should not rely on adding new Remotes; plain web server routes are available instead.
- `browser-use-runtime` keeps one browser per session across turns; it is relevant to the follow-up change that adds headless checks, not to this one.

Not yet verified, and therefore the first tasks: that an external package can resolve the `@deepseek-ai/dsh-*` runtime and types it needs, register tools from a preset child entry, register a prefix route and reach it from a normal browser tab with the owner credential, observe `tools/execute` and `tools/post-execute`, map a session ID to its working directory, and load a client contribution.

## Goals / Non-Goals

**Goals:**
- Edit-to-preview latency under one second with no build step in the target repository.
- One source of truth for component metadata, shared by the validator, the catalog tool, the prompt guidance, and the renderer.
- The preview runs isolated from the DSH web SPA, so the kit's CSS and the GUI's CSS never interact.
- Fail early: the spike decides whether the external-plugin approach holds before any kit or DSL work starts.

**Non-Goals:**
- Headless browser rendering, computed layout boxes, journeys, lint, and screenshots (follow-up `add-design-journeys-and-checks`). In this change `design_view` projects the parsed tree, not computed layout.
- The DSH GUI panel and comments (follow-up `add-design-panel-and-comments`); the client package only carries the spike probe here.
- Reusable parameterized compositions (user-defined components with props).
- Publishing packages to a registry; installation is from this repository.
- Coordinating concurrent edits of one design folder by several sessions (last write wins).

## Decisions

### D1. pnpm workspace with one package per runtime target, composed by a bundle package

```text
packages/
  core/      design tree types, parser + validator, token resolver, view projection
  kit/       React components + component metadata (props schema, examples)
  renderer/  browser app: preview chrome, tree interpreter, live-reload client
  host/      DSH host plugin: discovery, watcher, routes, tools, auto-validation
  client/    DSH client plugin (spike probe now; panel in a follow-up change)
  preset/    the design preset definition and prompt section
  bundle/    installable entry that composes host, client, and preset
```

Packages are named `@filipeesch/dsh-design-<name>`. The renderer is built to a static bundle that the host package ships and serves. A single package was rejected because the browser bundle and the Node host plugin have different build targets and dependencies; mirroring DSH's own bundle packages keeps installation to one `dsh plugin add`.

### D2. Component metadata is the single source of truth

Each kit component exports metadata: props with types, enumerations, token types, defaults, whether an `id` is required, which props are events, allowed children, and a minimal example. The validator, `design_catalog`, the generated part of the prompt guidance, and the renderer all read it. A separate hand-written JSON schema was rejected because it would drift from the components.

### D3. Parse on the host with an established JSX parser and an allowlist walker

Screen files are parsed by a mature JavaScript parser with JSX support and error recovery (Babel's parser is the default candidate), then walked by an allowlist that converts accepted nodes into the design tree and turns everything else into diagnostics. Nothing is ever evaluated. The browser never parses; it receives the validated tree as JSON. A hand-written parser was rejected for the error-reporting effort it needs up front; the TypeScript compiler API was rejected as heavier for no gain here. Suggestions for misspelled components, props, values, and tokens use edit distance against the metadata and the token set.

### D4. `.dsx` file extension

App toolchains glob `*.jsx` and `*.tsx` (TypeScript, ESLint, bundlers, test runners) and would try to compile design files. A distinct extension keeps the design folder invisible to them; editors can map `.dsx` to JSX highlighting. `.design.jsx` was rejected because it still matches those globs.

### D5. Tokens become CSS custom properties

Tokens follow a subset of the W3C Design Tokens format. The resolver expands aliases with cycle detection and emits one CSS custom property per token on the frame root; kit components reference variables only. A token edit therefore only swaps variable values on reload. Off-token literals are applied inline and flagged by the validator.

### D6. One prefix route per plugin, Server-Sent Events for live reload

The host registers a single `prefix` route `/design/` with the default `required` admission:

```text
/design/<session>/[<screen>][?bp=<name>]   HTML shell of the renderer
/design/<session>/_/assets/*               renderer bundle (static, from the host package)
/design/<session>/_/project?rev=<n>        design tree, config, resolved tokens, diagnostics
/design/<session>/_/events                 Server-Sent Events: { rev } on every change
/design/<session>/_/files/*                local images from the design folder
```

The reserved `_` segment cannot collide with screen IDs, which must start with a letter. File serving resolves real paths and refuses anything outside the design folder. Server-Sent Events were chosen over WebSocket because upgrade routes accept exact paths only and the channel is one-way. An iframe inside the DSH SPA was rejected for this change in favor of a separate tab; the follow-up panel embeds the same URL.

### D7. One watcher and revision counter per design folder, shared by sessions

Projects are keyed by the absolute design folder path, so two sessions in the same repository share one watcher. File events are debounced (about 50 ms); changed files are re-parsed incrementally, diagnostics recomputed, the revision incremented, and subscribers notified. Watchers start lazily on the first preview request or tool call and stop after an idle period with no subscribers.

### D8. Interaction state keyed by node ID in the browser

The renderer keeps current screen, breakpoint, open overlays, active tabs, and field values in a map keyed by `<screen>/<node-id>`, mirrored to the tab's session storage. On a new revision it re-renders and keeps only entries whose IDs still exist. Nodes with structural addresses keep no state across reloads, which is one more reason the DSL requires IDs on interactive nodes.

### D9. Last valid tree per screen

The project endpoint returns, per screen, the last tree that validated without errors plus the current diagnostics. The renderer draws the last valid tree and overlays the diagnostics, which keeps the preview usable while the agent is mid-edit.

### D10. Deterministic mode as a renderer flag

A `deterministic=1` query parameter disables transitions and animations, freezes the clock, and blocks network access from the frame; the kit only ships bundled, openly licensed fonts and icons. Interactive use keeps animations. Headless tools in the follow-up change always use the flag.

### D11. Automatic validation through `tools/execute` plus `tools/post-execute`

A `tools/execute` wrapper takes a fingerprint (path, size, modification time) of the design folder before and after delegating, and stores the changed-file set under the call's execution token. A `tools/post-execute` listener reads that set, validates the changed files, and attaches a capped summary as context. This detects changes from any tool, including shell commands. Relying on watcher events was rejected because file-system notifications can arrive after the tool returns. For calls nested inside programmatic tool calling, the summary is also aggregated onto the enclosing call so the model sees it.

### D12. Tools contributed by the preset, routes by the host plugin

The preview route and the project registry are global (loaded with the bundle), because the preview must answer for any session with a design project. The design tools and the auto-validation listeners are child plugins of the `design` preset, so only design sessions get them and other presets stay unchanged.

### D13. Preset definition reuses the default composition

The preset lists the default preset's child plugins plus the design tools plugin and a prompt section. If the preset registry supports referencing or extending another preset, the design preset extends the default one; otherwise it copies the list and a test compares it with the installed default preset to catch drift after DSH upgrades. The prompt section combines hand-written workflow guidance with a component index generated from D2 metadata, and a test enforces the 6,000-character limit.

### D14. Development installation by link

During development the bundle is installed with `dsh plugin --profile <profile> add link:<checkout>/packages/bundle`, so rebuilding the packages is enough to pick up changes on restart. Installing from the git repository works the same way for other machines.

## Risks / Trade-offs

- [External package cannot resolve DSH runtime or types] -> The spike runs first. Fallbacks in order: depend on the DSH packages through the profile's resolution as peer dependencies; vendor the minimal type declarations; as a last resort, move the host and client packages into the DSH monorepo and keep this repository for core, kit, renderer, and specs.
- [External client plugins need DSH's own client build] -> Probed in the spike even though the panel is a later change; if it fails, the panel change falls back to the preview in its own tab and the decision is revisited before that change is planned.
- [The owner credential does not reach a plain browser navigation to `/design/`] -> Probed in the spike. Fallback: tools return a URL with a short-lived, single-session token that the route accepts once and exchanges for the same owner admission; anonymous access is never allowed.
- [Context attached to nested programmatic calls is not shown to the model] -> D11 aggregates onto the enclosing call; covered by a test that edits through `run_code`.
- [Mapping a session ID to its working directory needs an API the plugin cannot reach] -> Probed in the spike; fallback is recording the working directory when a design tool first runs in that session.
- [The kit is large (about 40 components)] -> Built in tiers: layout, text, buttons, form controls, tabs, and overlays first, then the rest; a test fails when a component lacks metadata, catalog details, or an example.
- [Agents repeat the same DSL mistakes] -> A corpus of typical model mistakes becomes validator tests that assert the message and suggestion, and the prompt guidance shows the most common corrections.
- [Copying the default preset drifts after DSH upgrades] -> The drift test from D13.

## Migration Plan

None: greenfield. Rollback is removing the bundle from the profile; target repositories keep their `design/` folders as plain files.

## Open Questions

- Which bundled font and open-license icon set the kit ships.
- The default token palette scaffolded by `design_init`.
- The watcher idle timeout and the cap on attached diagnostics (start with 5 minutes and 10 diagnostics).
