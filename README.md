# dsh-design

The design plugin for DeepSeek Harness (DSH). It lets an agent sketch a
clickable, responsive web app in a restricted JSX-style DSL, preview it live in
the browser, and iterate with validation feedback attached to every edit.

This repository implements the `add-design-foundation`,
`add-design-journeys-and-checks`, `add-design-panel-and-comments`,
`add-design-variants`, `anchor-design-comment-composer`, and
`add-design-handoff` OpenSpec changes. The plugin is developed here,
outside the DSH source tree, and installed into a DSH profile with `dsh plugin`.

## Requirements

- Node.js 24.9 or newer
- pnpm 11
- A DSH installation whose profile can install local bundles
- Optional: a Playwright Chromium for headless journeys, lint, layout snapshots,
  and screenshots. Preview and static tools work without one.

## Build

```sh
pnpm install
pnpm run build
pnpm run test
pnpm run check   # build, lint, format, EOF-newline check, tests
# real Chromium regressions run when a Playwright browser is available; otherwise they skip
# install the matching browser for the full suite:
pnpm exec playwright install chromium
```

## Install

Build first: the bundle serves the built renderer, fonts, and client files.

Linked development checkout:

```sh
dsh plugin --profile <profile> add link:<checkout>/packages/bundle
```

Reproducible local artifact (works from a fresh clone after `pnpm install`):

```sh
pnpm run pack:bundle
dsh plugin --profile <profile> add <checkout>/dist/filipeesch-dsh-design-bundle-0.1.0.tgz
```

Either route installs the same built bundle; the tarball does not require the
profile to see the source checkout. Restart DSH after installing. The profile
then lists the **Design** agent preset, and the preview route answers under
`/design/<session-id>/` on the DSH web server. Opening a design session gives the agent `design_init`, `design_status`,
`design_validate`, `design_view` (including measured layout), `design_catalog`,
`design_run_journey`, `design_lint`, `design_screenshot`, `design_query`,
`design_diff`, and `design_handoff`.

A session whose working directory contains `design/design.json` gets a live
preview. The agent shares the URL from `design_status`; open it in a normal
browser tab while signed in to DSH, or use the native **Design** action in the
session header to place the same preview beside the conversation.

## Update

Rebuild, then restart the profile:

```sh
pnpm run build
```

The linked bundle picks up the new `lib/` output on the next DSH start. No
profile reinstall is needed for code changes; reinstall only if the bundle
manifest or patch changes.

## Remove

```sh
dsh plugin --profile <profile> remove @filipeesch/dsh-design-bundle
```

Restart DSH. The preset, tools, route, and client contribution are gone; DSH
starts normally. Design folders in target repositories stay as plain files.

## Packages

| Package    | Role                                                                                  |
| ---------- | ------------------------------------------------------------------------------------- |
| `core`     | Design tree, parser, validator, tokens, project loading, scaffolding, view projection |
| `kit`      | Component metadata and React components                                               |
| `renderer` | Standalone preview app (chrome, interpreter, live reload, state)                      |
| `host`     | DSH host plugin: registry, watcher, routes, tools, auto-validation                    |
| `client`   | DSH client plugin: native session Design tab, header action, preview frame            |
| `preset`   | `design` agent preset and prompt section                                              |
| `bundle`   | Installable DSH bundle composing the above                                            |

Design files in a target repository are versioned sources: `design/design.json`,
`design/tokens.json`, `design/screens/*.dsx`, optional
`design/fixtures/*.json`, and optional `design/journeys/*.dsx`. Derived files
(including screenshots) belong only in `design/.cache/`, which the scaffolded
`.gitignore` excludes.

## Variants

A screen can hold mutually exclusive alternatives. The normal preview, journeys,
checks, and handoff always use the chosen branch; exploring an alternative never
changes the source.

```jsx
<Variants id="layout" chosen="compact">
  <Variant branch="compact">
    <Stack gap="spacing.sm">...</Stack>
  </Variant>
  <Variant branch="spacious">
    <Stack gap="spacing.lg">...</Stack>
  </Variant>
</Variants>
```

A whole-screen group at the file root wraps one `<Screen>` per branch with the
same id. Stable node ids may repeat across exclusive branches. Every branch is
validated, and wrappers never render.

- `/design/<session>/<screen>?variant=layout:spacious` opens one branch.
- `/design/<session>/<screen>?compare=layout:compact:spacious` keeps both
  branches side by side at the same breakpoint and state. Panes are isolated and
  scroll internally on narrow hosts.
- `design_view`, `design_query`, and `design_screenshot` accept
  `variant: "group:branch"`; screenshots for different branches never overwrite
  each other.
- `design_diff` compares two branches or the chosen projection at two local Git
  revisions without checking out or writing anything.

Promotion is an ordinary source edit: record rejected branches under
`design/.discarded/`, replace the `<Variants>` block with the winning children,
and validate. Clean that folder only when the owner explicitly asks. See
[`docs/variants-workflow.md`](docs/variants-workflow.md).

## Named states, fixtures, and journeys

A screen can declare deterministic starting points:

```jsx
<Screen id="orders" states={{ "filter-open": { open: ["filters"], values: { search: "acme" } } }}>
```

Open one with `/design/<session>/orders?bp=mobile&state=filter-open`. The state is
seeded once per screen/state route transition, survives valid hot reloads, and
does not reseed when only the breakpoint changes.

Fixtures are bounded, project-local JSON arrays of flat fictitious objects with
unique kebab-case `id`s. Bind them without writing logic:

```jsx
<List id="orders" items={fixture("orders")}>
  <ItemTemplate>
    <Text>{item("name")}</Text>
  </ItemTemplate>
</List>
<Table columns={[{ label: "Name", field: "name" }]} rows={fixture("orders")} />
<Select id="plan" options={fixture("plans")} />
```

Journeys live in `design/journeys/*.dsx` and use stable design ids:

```jsx
<Journey id="checkout" start="orders" state="filter-open" breakpoint="mobile">
  <Choose target="plan" value="pro" />
  <Type target="email" value="ada@example.com" />
  <Tap target="place-order" />
  <ExpectScreen screen="confirmation" />
</Journey>
```

See [`examples/synthetic-checkout`](examples/synthetic-checkout) for a runnable,
entirely fictitious project covering states, fixtures, tables, lists, selects,
and two journeys.

## Design panel and review comments

The plugin contributes a native, session-scoped **Design** tab to the DSH right
sidebar and a **Design** action in the session header. The tab frames the same
owner-authenticated interactive preview on the same origin, offers **Open in
tab**, and offers **Back to chat** for narrow layouts. The frame is limited to
the owning origin; deterministic documents stay unembeddable and carry no review
controls.

In the interactive preview, **Comment** turns component selection on. A click or
the keyboard picker (arrow keys move, Enter selects, Escape exits) targets a
rendered component without activating it. A draft captures the screen,
breakpoint, component type, stable design id or a visibly unstable structural
address, the named state, open overlays, tab selections, and the design
revision. Structural anchors also carry a content fingerprint of the rendered
screen, so an unchanged preview after an idle runtime reset keeps its pin while
a same-address edit does not; the numeric revision is diagnostic only. Free-form
field values, secrets, and arbitrary DOM content are not captured. Drafts live in DSH host memory keyed by session, not in the design
repository: they survive a browser reload and separate tabs of the same session,
but not a DSH process restart. Removing the DSH session (or disposing the
plugin) clears its drafts; a browser reload does not. Two sessions over one project have separate
pending sets.

Keyboard selection moves through the visible components, selects a
non-focusable structural node, exits with Escape without closing an open
drawer, and restores focus. The editor is a balloon beside the selected
component with a pointer, kept inside the visible preview pane on a desktop
browser at the desktop and Mobile breakpoints and in a narrow sidebar; the
pin reopens it at the same component. The open editor follows the same anchor
rules as its pin: another screen, state, variant, changed structural content, or
a short pane with no non-overlapping side drops the arrow and keeps the text
editable until the original anchor is valid again. A draft whose target is no
longer available keeps its text editable from Pending without a false pointer.
One session holds at most 50 pending comments; the
batch limit is the same, so every accepted draft can be sent together, and the
Comment control explains when the limit is reached.

**Send** submits the exact reviewed draft revisions as one ordinary queued user
message. Rejected delivery keeps the drafts and its retry; a replay of an already
accepted batch returns its acknowledgement without enqueuing another message.
Drafts added or edited while a batch is in flight stay pending. The success
message counts the versions the session accepted, separately from the drafts
it cleared and any that remain.

See [`docs/review/panel-review.md`](docs/review/panel-review.md) for the
disposable desktop and 390 CSS pixel review and
[`docs/verification.md`](docs/verification.md) for recorded evidence.

## Headless checks

`design_run_journey` executes the declared steps on the real kit controls and
stops at the first failed step with a bounded semantic snapshot. `design_lint`
measures every configured breakpoint for canvas/container overflow, peer
overlap, clipped text, pointer targets under 44 CSS pixels, and validator
off-token warnings. `design_screenshot` is opt-in and writes a deterministic
canvas-only PNG under `design/.cache/screenshots/`. `design_view` with an
explicit `breakpoint` returns computed boxes; without it, it stays browser-free.

Browser work is lazy: one Chromium per active DSH session, serialized per
session, fresh isolated context per check at the project breakpoint width and a
fixed 900 CSS px viewport height, and disposed with the session or the plugin.
Chromium always launches with its sandbox enabled and the tool never falls back
to an unsandboxed browser. Missing Chromium and sandbox failures are reported
explicitly. Configure an executable with
`DSH_DESIGN_CHROMIUM_PATH` (or `PLAYWRIGHT_CHROMIUM_PATH`), or install the
browser matching the installed `playwright-core`:

```sh
pnpm exec playwright install chromium
```

## Implementation handoff

`design_handoff` generates a reproducible implementation package on demand under
`design/.cache/handoff/<content-id>/`. It resolves the requested screen, named
state, and breakpoint matrix before opening a browser, then writes:

- chosen-only, editable `screens/*.dsx` with stable ids, interactions, and named
  states, and no variant wrappers or discarded branches;
- the necessary `tokens.json`, `tokens.resolved.json`, `design.json`, local
  raster assets, and relevant `journeys/*.dsx` acceptance flows;
- a bounded chosen-source closure for selected `navigate()` targets and journeys:
  supporting screens are marked and get DSX only, never extra projections;
- matching semantic layout JSON and canvas PNGs from the same committed canvas;
- a sorted `manifest.json` separating the requested `selection` from the
  `support` closure, with explicit dimensions, choices, browser/kit identity,
  artifact sizes, and SHA-256 digests. `design.json` keeps every configured
  breakpoint so responsive maps remain valid, even for a narrower evidence set.

Omitted selectors default to every valid chosen screen, the unnamed state plus
every named state, and every configured breakpoint, bounded to 24 projections and
32 screens. Use `states: ["$default"]` for the unnamed state; a named state is
selected by its literal name, including `"default"`. Projection ids are
collision-free length-prefixed tuples. The package is content-addressed and
verified before reuse; invalid, stale, interrupted, or partially published output
fails explicitly. It is derived cache, never committed. A coding agent in any
preset can read the manifest and package with ordinary file tools; handoff stays
in the Design preset.

The import workflow is out of scope for this repository change: no import
tooling, settings, or artifacts are shipped.

See [`docs/handoff.md`](docs/handoff.md).

## Development notes

- The preview is served only by the local DSH web server. The route demands
  `required` admission and additionally checks the owner principal, following
  DSH's open-in-app pattern. It never deploys anywhere.
- Project media is a separate route from trusted bundle assets. It serves only
  bounded, signature-checked passive raster images (PNG/JPEG/GIF/WebP) from the
  canonical design folder, with `nosniff`, no-store, sandbox CSP, and
  same-origin resource policy. SVG, HTML, JavaScript, and arbitrary project
  files are never served.
- The `css` escape hatch uses one shared parser/validator in core; the renderer
  turns its declarations into authoritative node-scoped rules and rewrites
  local `url()` targets through the project-file route.
- Deterministic mode serves one self-contained document: project state,
  renderer code/styles, bundled Inter fonts, and bounded validated local raster
  bytes are inlined. After the initial navigation there are no project, asset,
  font, or image requests, including interactions and screen changes. A strict
  CSP disables connections, the rendering clock is fixed, and icons are inline
  SVG.
- The bundled Inter files cover the Latin subset declared by their
  `unicode-range`. Characters outside that range use the browser's fallback
  font, which is not bundled; deterministic rendering of such text therefore
  depends on the platform font.
- `pnpm run pack:bundle` produces the artifact used for non-link installs. The
  documented machine flow is clone -> install -> build -> pack -> `dsh plugin`
  install of that local tarball; a direct Git URL install is not claimed.
- The bundle deliberately imports no `@deepseek-ai/*` runtime module, so a
  public checkout installs with plain `pnpm install`.
- Fixtures and journeys are read on every project load, participate in the
  watcher fingerprint, and report diagnostics through the same file/screen
  scopes and automatic edit summaries as screens.
- Browser checks reuse the existing self-contained deterministic document, bind
  a synthetic local origin, fulfill only that document, and block every other
  request and service worker.
- Named states and fixture expansions are validated before they reach the
  renderer; repeated ids derive from the list id, fixture key, and template
  identity, never from array position.
- The design preset copies DSH's shipped `standard` composition; a drift test
  compares it when `DSH_CHECKOUT` points at a DSH checkout.
- Verification evidence from the implementation run is in
  [`docs/verification.md`](docs/verification.md).
