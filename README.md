# dsh-design

The design plugin for DeepSeek Harness (DSH). It lets an agent sketch a
clickable, responsive web app in a restricted JSX-style DSL, preview it live in
the browser, and iterate with validation feedback attached to every edit.

This repository implements the `add-design-foundation` OpenSpec change. The
plugin is developed here, outside the DSH source tree, and installed into a DSH
profile with `dsh plugin`.

## Requirements

- Node.js 24.9 or newer
- pnpm 11
- A DSH installation whose profile can install local bundles

## Build

```sh
pnpm install
pnpm run build
pnpm run test
pnpm run check   # build, lint, format, EOF-newline check, tests
# real Chromium regressions run when a Playwright browser is available; otherwise they skip
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
`/design/<session-id>/` on the DSH web server. Opening a design session gives the agent `design_init`,
`design_status`, `design_validate`, `design_view`, and `design_catalog`.

A session whose working directory contains `design/design.json` gets a live
preview. The agent shares the URL from `design_status`; open it in a normal
browser tab while signed in to DSH.

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
| `client`   | DSH client plugin (activation marker; no dead UI action)                              |
| `preset`   | `design` agent preset and prompt section                                              |
| `bundle`   | Installable DSH bundle composing the above                                            |

Design files in a target repository are versioned sources: `design/design.json`,
`design/tokens.json`, and `design/screens/*.dsx`. Derived files belong only in
`design/.cache/`, which the scaffolded `.gitignore` excludes.

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
- The design preset copies DSH's shipped `standard` composition; a drift test
  compares it when `DSH_CHECKOUT` points at a DSH checkout.
- Verification evidence from the implementation run is in
  [`docs/verification.md`](docs/verification.md).
