# Design handoff

This document covers the standalone `design_handoff` tool. The import workflow
is out of scope for this repository change: no import tooling, settings, or
artifacts are shipped.

## What it does

`design_handoff` generates an on-demand implementation contract from the current
validated chosen design. It resolves the requested screen, named-state, and
breakpoint matrix before rendering, then writes a content-addressed package under
`design/.cache/handoff/<content-id>/`.

Nothing generated is committed. The scaffolded `design/.gitignore` excludes the
cache. The pinned kit version and deterministic renderer make regeneration
reproducible.

## Selection

`design_handoff({ screens?, states?, breakpoints? })`

- Omitted `screens` means every valid chosen screen.
- Omitted `states` means the unnamed state plus every declared named state.
- Omitted `breakpoints` means every configured breakpoint.
- `states: ["$default"]` selects only the unnamed state.
- A named state is selected by its literal name, including a state literally
  named `"default"`.
- An explicit named state must be declared and compatible on every explicitly
  selected screen.

The requested matrix is bounded to 24 screen/state/breakpoint projections. The
chosen-source closure is bounded to 32 screens. Unknown, duplicate, stale, or
incompatible selectors fail explicitly.

## Chosen-source support closure

The package includes a bounded set of supporting chosen sources needed to keep
the exported design valid:

- screens reachable through selected `navigate()` interactions;
- screens required by relevant acceptance journeys.

Supporting screens are marked in `manifest.support.screens` and
`manifest.screens[].role`. They receive DSX only; they never add layouts,
screenshots, or projections. Journeys outside the selected matrix are listed in
`outsideScreens`; unrelated screens and flows are excluded.

## Package contents

```text
manifest.json
README.md
design.json
tokens.json
tokens.resolved.json
screens/<screen>.dsx
journeys/<journey>.dsx
layout/<length-prefixed-projection>.json
screenshots/<length-prefixed-projection>.png
<local raster assets at their original relative paths>
```

- `screens/*.dsx` is editable chosen DSX: stable ids, declarative interactions,
  literal props, and named screen states. Variant wrappers and non-chosen
  branches are absent. It is parsed back and compared to the chosen tree before
  publication.
- `design.json` preserves **every configured breakpoint**, even when the
  requested evidence matrix uses a subset, so responsive maps remain valid.
- `manifest.selection` records the requested screens, states, breakpoints, and
  projections; `manifest.support` records supporting screens/reasons and the
  full breakpoint configuration.
- `tokens.json` is the project support input; `tokens.resolved.json` is the
  resolved token table.
- Relevant journeys are copied source with acceptance steps and dependency
  information in the manifest.
- Layout JSON and PNG are collected from the same committed canvas in one
  render. Boxes are CSS pixels relative to that canvas.
- Local raster assets referenced by selected and supporting screens are copied
  at the paths the DSX uses.
- Projection ids are collision-free length-prefixed tuples, so component names
  containing `--` cannot collide.

The manifest includes explicit dimensions, effective choices, kit pin and
installed kit, renderer identity, browser environment, journey dependencies, and
sorted file sizes and SHA-256 digests. The package id is the digest of the
manifest without its own id field.

## Reproducibility and cache safety

Given the same validated source and deterministic rendering environment, reruns
and separate workspaces produce identical manifest and file bytes. Distinct
effective inputs produce distinct directories and never overwrite an earlier
package.

Before publication, the complete package is written to private staging,
verified file by file, and exposed by one atomic rename. Reused packages are
verified before return. Invalid, partial, tampered, or interrupted output fails
explicitly. Cancellation is checked through publication up to that commit and
removes staging without leaving a completed artifact.

## Consuming the package

Share the project-relative `manifest.json` path with the implementing agent. It
needs only ordinary file access: read the manifest, chosen DSX, tokens, layouts,
screenshots, and journeys. It does not need a handoff tool, and the default
coding preset does not gain one.

Do not edit a generated package in place. Regenerate it after a chosen design
change, or copy what is needed into an implementation plan. Do not commit
derived output.

## Verification

```sh
pnpm exec vitest run packages/core/tests/handoff.spec.ts
pnpm exec vitest run packages/host/tests/handoff.spec.ts
pnpm exec vitest run packages/host/tests/cache.spec.ts
pnpm run check
openspec validate add-design-handoff --strict
```

The disposable real-DSH handoff procedure is in
[`docs/review/handoff-review.md`](review/handoff-review.md), with recorded
evidence in [`docs/verification.md`](verification.md).
