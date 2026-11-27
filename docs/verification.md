# Verification evidence

## Design preview performance (stabilize-design-preview)

- `VITEST_MAX_WORKERS=1 pnpm run check` with a real Chrome for Testing executable passed all 510 tests in 38 files, including build, declaration checks, lint, formatting, and newline checks. The focused six-document HTTP/1.1 Chromium regression also passed on its own. A real file edit reached the foreground preview within one second; visibility return caught up without losing the input value. The visibility signal was emulated where headless Chromium reported all tabs visible.
- The [installed bundle comparison](review/preview-transfer.md) measured 467,997 bytes on installed 0.1.3 versus 17,906 bytes on the packed candidate (96.17% fewer transferred preview body bytes through the first canvas) on the same 30-screen project with a panel-warmed cache and an idle agent. Both builds navigated all 30 screens and the tested map situation without a document reload.
- The evidence establishes the preview connection regression and the transfer reduction, not a fix for system-wide slowdown. The live DSH profile was not modified.

## Design agent experience (improve-design-agent-experience)

- The complete project gate passed with real sandboxed Chromium: 503 tests in
  36 files, plus build, declaration checks, lint, formatting, and newline
  checks. Test files ran sequentially (`VITEST_MAX_WORKERS=1`) to avoid competing
  browser startup on the local host.
- The installed DSH dispatcher reported ten Design tools and none in Standard.
  It verified nested geometry input schemas, invalid selection before browser
  launch, ordered focused results with no image, and an explicit missing-browser
  result. The representative checkout journey and captured canvas were verified
  in both builds. See [installed evaluation](review/design-eval.md).
- The follow-up [native dispatcher checks](review/design-installed-dispatch.md)
  verify that Status reports the running host and tools, including a real
  on-disk replacement and mixed running builds. They also verify that the kit
  is shown separately, validation reports the authored layout location, and
  invalid or ambiguous scopes never return successful results. All five
  candidate dispatcher runs passed.
- The [legacy renderer regression](../packages/renderer/tests/legacy-appearance.spec.ts)
  matches computed styles captured from the pinned baseline without themes or
  classes. It covers desktop and mobile in both the interactive preview and
  deterministic browser checks, including fields, focus, Drawer, and Toast.
- Follow-up Chromium checks verify that changing a live popover anchor keeps
  focus in the open panel and returns it to the new anchor on Escape. They
  also verify at least 3:1 contrast for the opt-in dark Switch track boundary.
- The latest release console screenshots are in
  `/tmp/dsx-review-polish.f0YbyC/`: desktop light, mobile dark, the anchored
  popover, the restored focus after dismissal, and the live anchor change.
  These temporary PNGs are not committed.

## First Design turn (v0.1.1)

- The installed v0.1.0 bundle reproduced the prompt assembly error when DSH
  treated a responsive DSX example as a prompt variable.
- In the installed v0.1.1 bundle, DSH's prompt renderer preserved both the
  responsive and named-state DSX examples as literal text and continued to
  interpolate an ordinary model variable in a separate section.
- A first Design turn in a disposable DSH Web profile passed the literal
  examples and Design tools to a local test adapter and recorded a completed
  turn. No external model or user profile was used.
- `pnpm run check` passed all 325 tests in 25 files.

## GitHub Release distribution (add-github-release-distribution)

- Published [v0.1.0](https://github.com/filipeesch/dsh-design/releases/tag/v0.1.0)
  from source commit `c7b68a1`. The rebuilt 1,326,516-byte bundle matched the
  previously verified local tarball. SHA-256:
  `ee7d46a81cc20b4a9ce86392cdc95dfb7103ee9f504b77a99761f9345475fe35`.
- The full Vitest suite passed: 324 tests across 25 files. The archive audit
  inspected 22 files, including source maps, and found no live capture tooling,
  worker, or configuration and no install-time build scripts.
- Both public download URLs (latest and versioned) returned the same bundle
  and checksum bytes as the staged release files.
- A disposable DSH Web profile installed and enabled `@filipeesch/dsh-design-bundle@0.1.0`
  through the UI using the exact latest URL. No build-script approval was needed.
  After restart, the Design preset opened the synthetic catalog at 390 px and
  1280 px (authenticated HTTP 200). A separate test using the local tarball
  produced the same previews. All temporary servers were stopped.

## Historical: Design handoff (add-design-handoff)

Checks run on the packed bundle for this change, on top of the published
baseline `a3f13e8`. The disposable profile used a separate loopback port; the
live GUI on 3080 and the DSH implementation checkout were not modified. The
repeatable procedure is in
the historical `docs/review/handoff-review.md` at the release under test.

```sh
pnpm run check
openspec validate add-design-handoff --strict
pnpm run pack:bundle
```

Results:

- `pnpm run check` exits 0: build, compile-time type tests, ESLint, Prettier,
  EOF newline, and Vitest. Vitest reports 25 files and 323 tests passed,
  including the real Chromium handoff, preview, variant, comment, and check
  suites.
- `openspec validate add-design-handoff --strict` passed before archive. All
  five implementation and verification tasks are complete.
- The preset drift test passed with `DSH_CHECKOUT=<path-to-dsh-checkout>`: the
  Design preset still differs from the shipped standard composition only by
  `design-session`, so the default coding preset is unchanged.
- `pnpm run pack:bundle` writes
  `dist/filipeesch-dsh-design-bundle-0.1.0.tgz` (1,326,516 bytes; sha256
  `ee7d46a81cc20b4a9ce86392cdc95dfb7103ee9f504b77a99761f9345475fe35`).
- The packed artifact contains the handoff tool and no import tool. A full
  extract scan found no `design_capture`, `captureOrigins`, `captureTimeoutMs`,
  or `DSH_DESIGN_CAPTURE_ORIGINS`; neither preset registers an import tool.
- The packed artifact was installed into a fresh disposable profile and booted
  on a non-3080 loopback port with the synthetic workspace.
  `docs/review/handoff-review-session.mjs` reported:

  ```text
  REVIEW_TOOLS {"design":["design_catalog","design_diff","design_handoff","design_init","design_lint","design_query","design_run_journey","design_screenshot","design_status","design_validate","design_view"],"standard":[]}
  REVIEW_HANDOFF {"mobile":{"id":"a5f55edec0782bf133b87a1ee2026dbfc8a65bf8712a2562486b014389a34a3b","projections":1,"screens":["checkout"],"supportingScreens":["catalog","confirmation"],"breakpoints":["mobile"],"files":11,"supportBreakpoints":[{"name":"mobile","width":390},{"name":"tablet","width":768},{"name":"desktop","width":1280}],"cacheRelative":true,"noCapture":true,"noAbsolutePath":true},"desktop":{"id":"a7ab63de711b02dac3ca79a7adf31d7544b751f30488730e4ae34ee237979104","projections":1,"breakpoints":["desktop"],"distinctId":true}}
  REVIEW_REPRODUCIBLE {"reused":true,"sameId":true,"sameWorkspaceFiles":true,"otherWorkspaceSameId":true,"otherWorkspaceSameFiles":true,"fileCount":12}
  REVIEW_REOPEN_MOBILE {"errors":0,"warnings":0,"journeys":[{"id":"catalog-to-confirmation","ok":true,"steps":10},{"id":"checkout-review","ok":true,"steps":5}],"allJourneysPass":true}
  REVIEW_REOPEN_DESKTOP {"errors":0,"warnings":0,"journeys":[{"id":"catalog-to-confirmation","ok":true,"steps":10},{"id":"checkout-review","ok":true,"steps":5}],"allJourneysPass":true}
  REVIEW_CACHE_IGNORE {"cacheIgnored":true}
  ```

  The Design session had `design_handoff` and no import tool; the standard
  session had no design tools. The harness created both sessions without
  prompting a model, so the run made no real model call. The Mobile package
  was regenerated after deletion and reproduced in a second synthetic
  workspace with the same id and bytes. Both Mobile-only and Desktop-only
  packages reopened unchanged in fresh DSH workspaces, validated with zero
  errors, and passed both applicable journeys in real Chromium.
  `git check-ignore` reported `design/.gitignore:1:.cache/` for both handoff
  manifests; no import-artifact directory exists.

- `docs/review/handoff-check.mjs` against the same disposable instance reported
  `{"ok":true,"failures":[]}`: desktop canvas 1280 px in a 1440 px document
  with zero horizontal overflow and the review drawer open; Mobile canvas
  390 px in a 390 px document with zero overflow and the drawer open; handoff
  layouts and PNGs both 1280 px (desktop `$default`) and 390 px (Mobile
  `review-open`); two handoff packages; `captureCacheAbsent: true`.
- Targeted regressions cover cache reuse, tampered/partial package refusal,
  staging cleanup, symlinked cache refusal, pre-call and late cache
  cancellation with no completed artifact, concurrent same-id publication,
  explicit and bounded selection, stale/invalid source refusal, mutation of
  tokens and journeys after the validated snapshot, chosen-only DSX round trip
  with fixture-expanded ids, full configured breakpoints with a requested
  subset, supporting-source closure for selected navigation and journeys with
  no extra projections or unrelated flows, reopened `design_validate` and
  journey checks, named state `"default"` versus the unambiguous `$default`
  selector, collision-free projection ids for delimiter-bearing tuple
  components, interaction and named-state preservation, cross-workspace byte
  identity, distinct effective inputs, and relevant-journey cross-screen
  dependencies.
- Independent Codex review passed on the exact shipped SHA-256 above. All 22
  installed files matched the tarball. Design registered handoff; Standard read
  its manifest with the ordinary file tool. Neither preset registered live app
  capture, and the packed sources, source maps, and configuration excluded it.
- The independently reopened Desktop-only and Mobile-only packages each had
  zero validation errors and warnings, one layout and PNG, and both journeys
  passed (10 and 5 steps). All 11 files per package matched across fresh
  regenerations in the same and another workspace. Cancellation during staging
  exposed no new package and left staging empty.
- The reviewer inspected both live previews and exported PNGs in Chromium. The
  1280 × 520 and 390 × 520 canvases showed the review drawer without page-wide
  horizontal overflow; all seven compared stable-ID boxes matched at each
  width. The deterministic PNG excludes preview chrome and is not expected to
  be pixel-identical to the interactive preview.
- The disposable review processes were stopped. Neither checkout nor the
  synthetic fixture sources were modified during independent review.

Checks run while implementing `add-design-journeys-and-checks` on top of the
`add-design-foundation` baseline. Paths are portable placeholders; no owner
token, real session id, temporary home, or machine-specific path is recorded.

## Design variants (add-design-variants)

Checks run on the packed bundle for this change, on top of baseline
`6f7627d`. The disposable profile used a separate loopback port; the live GUI
on 3080 and the DSH checkout were not modified. The repeatable procedure is in
[`docs/review/variants-review.md`](review/variants-review.md).

```sh
pnpm run check
openspec validate add-design-variants --strict
pnpm run pack:bundle
```

Results:

- `pnpm run check` exits 0: build, compile-time type tests, ESLint, Prettier,
  EOF newline, and Vitest. Vitest reports 22 files and 289 tests passed,
  including the full real Chromium preview suite and the comparison panes.
- `openspec validate add-design-variants --strict` reports
  `Change 'add-design-variants' is valid`.
- `pnpm run pack:bundle` writes
  `dist/filipeesch-dsh-design-bundle-0.1.0.tgz` (1,281,670 bytes; sha256
  `903b3ec6f4137489f328a379e674260a93caf92025673e01ca6e5c3248bfa66d`).
- The packed artifact was installed into a fresh disposable profile and booted
  on a non-3080 loopback port with the synthetic variants workspace. The boot
  log reported: one screen (`catalog`), group `layout` with chosen `compact`
  and both branches valid; chosen and alternate `design_view` projections
  distinct; `design_query` finding `checkout` in the spacious branch;
  distinct branch-named screenshots under `design/.cache/screenshots`;
  `design_diff` reporting the stable `checkout` parent move and the
  `Continue` text change; and `design_status` still listing only `catalog`
  while an ignored `design/.discarded/rejected.dsx` existed.
- `docs/review/variants-check.mjs` reported `{"ok":true,"failures":[]}` with
  evidence: 1280 and 390 CSS pixel canvases kept exactly in both panes, no
  page-wide horizontal overflow, keyboard scrolling inside the 390-pixel
  comparison region, clearing the shared starting state resetting both panes'
  drawers and seeded values, a comment on the shared `open-filters` id pinned
  only in the spacious pane and recorded `variant=layout:spacious` in the
  session queue, malformed and unknown selections staying explicit, Back
  restoring the previous comparison, one deterministic request with no comment
  UI, and anonymous preview refused with 401.
- `git check-ignore` reported `design/.gitignore:2:.discarded/` and
  `design/.gitignore:1:.cache/`; the disposable workspace's Git status stayed
  clean after the screenshots and comment checks.
- Targeted regressions cover: subtree, whole-screen and nested group parsing
  with source locations; malformed, empty, duplicate and missing-choice
  diagnostics; ancestor selection and contradiction; wrapper removal and
  address reindexing; shared ids in exclusive branches and duplicate ids in a
  combined projection; fixture expansion in an alternate branch; branch-only
  diagnostics not blocking the chosen render; last-valid variant document
  retention; preview route parsing, diagnostics, comparison history, exact
  widths, isolated fields/focus, and live reload; variant-aware status, view,
  query, screenshot identity, and state incompatibility; semantic diff moves
  versus insertion shifts, anonymous structural fallback, typed prop/text
  changes, stable-branch and committed-revision modes, missing historic inputs,
  committed config/tokens/screen diagnostics, duplicate committed screen ids,
  direct-child source discovery, and unchanged worktree/index/branch;
  ordinary-text promotion, ignored discard records, and cleanup that leaves
  live sources intact. The targeted remediation regressions additionally cover
  shared-selector reset after in-pane navigation and Back, local state preserved
  through a compatible SSE refresh, last-valid comparison panes with diagnostic
  overlays after invalid alternate edits, repaired panes mounting without a URL
  change, whole-screen branch-local states, disjoint nested groups, canonical
  comment identity across normal and explicit chosen views, and malformed or
  unknown variant/comparison/state selections. The final follow-up covers
  retained-only documents after structural failure: status reports every
  retained branch stale, view/query/diff/screenshot fail with current
  diagnostics instead of using retained data, and all recover after repair;
  inactive nested defaults keep prior valid content with diagnostics and repair
  cleanly.

## Component-anchored comment composer (anchor-design-comment-composer)

Checks run on the packed bundle for this change, on top of the approved variants
baseline `90978d9`. The disposable profile used a separate loopback port; the
live GUI on 3080 and the DSH checkout were not modified. The repeatable
procedure is in [`docs/review/composer-review.md`](review/composer-review.md).

```sh
pnpm run check
openspec validate anchor-design-comment-composer --strict
pnpm run pack:bundle
```

Results:

- `pnpm run check` exits 0: build, compile-time type tests, ESLint, Prettier,
  EOF newline, and Vitest. Vitest reports 22 files and 304 tests passed,
  including the full real Chromium preview and comparison suites.
- `openspec validate anchor-design-comment-composer --strict` reports
  `Change 'anchor-design-comment-composer' is valid`.
- `pnpm run pack:bundle` writes
  `dist/filipeesch-dsh-design-bundle-0.1.0.tgz` (1,284,433 bytes; sha256
  `97365656e2abc8cc1eda5b37410e1b5ba0bcdfc68975ea74a3faf4623b31a695`).
- The packed artifact was installed into a fresh disposable profile and booted
  on a non-3080 loopback port with the synthetic checkout workspace.
  `docs/review/composer-check.mjs` reported `{"ok":true,"failures":[]}` with
  evidence: the desktop panel opened the balloon beside the Email field with a
  pointer touching the balloon, a 360 CSS pixel compact editor inside the pane,
  and the 1280-pixel canvas unchanged; the pin reopened the balloon with its
  text, Escape closed it and restored pin focus; two drafts added exactly one
  pending entry each, one batch cleared them and recorded exactly one chat
  message; the mobile canvas kept its 390-pixel width with a compact balloon
  and pointer; an open drawer's Keep editing button opened a balloon with a
  pointer inside the mobile pane with the canvas geometry unchanged; the short
  native pane drew an arrow only when it could not cover the Email target and
  kept the text after the pointer was dropped; and the deterministic preview
  made no comment request and rendered no review controls.
- Targeted regressions cover: placing the balloon right, left, above or below
  the target with a visible pointer and no canvas reflow; flipping near a pane
  edge and staying compact in a 360-pixel pane instead of becoming a footer;
  never covering the target when an arrow is shown, including a 369x344 short
  pane and a pointerless fallback that keeps edited text when no side has
  usable room; recomputing on scroll and resize; focusing the editor only after
  it is placed; detaching an open new or reopened editor when the screen,
  state or variant changes, or when a reused structural address's content
  changes, then reattaching only at the original anchor with its text intact;
  never reattaching a stable/shared id on another screen; reopening a pin with
  Escape and focus restoration; editing an unavailable draft from Pending
  without a pointer; drawer selection by pointer and keyboard at desktop and
  Mobile preview breakpoints on a desktop browser; each comparison pane
  keeping its own anchored balloon and branch-scoped pin; and unchanged batch
  delivery, variant context and deterministic behavior.

## Design panel and review comments (add-design-panel-and-comments)

Checks run on the packed bundle for this change. The disposable profile used a
separate loopback port; the live GUI on 3080 and the DSH checkout were not
modified. The repeatable procedure and manual desktop/mobile steps are in
[`docs/review/panel-review.md`](review/panel-review.md).

```sh
pnpm run check
openspec validate add-design-panel-and-comments --strict
pnpm run pack:bundle
```

Results:

- `pnpm run check` exits 0: build, compile-time type tests, ESLint, Prettier,
  EOF newline, and Vitest. Vitest reports 18 files and 221 tests passed,
  including the real Chromium preview and headless-check suites.
- `openspec validate add-design-panel-and-comments --strict` reports
  `Change 'add-design-panel-and-comments' is valid`.
- `pnpm run pack:bundle` writes
  `dist/filipeesch-dsh-design-bundle-0.1.0.tgz` (sha256
  `17b9ae3c0ef330d7096cce3fb486b5fbd20346fdf5767bc465e65bb433145bd2`).
- The packed artifact was installed into a fresh disposable profile and booted
  on a non-3080 loopback port. `docs/review/panel-check.mjs` reported
  `{"ok":true,"failures":[]}` with evidence: a desktop panel frame of 647 CSS
  pixels, zero page-wide horizontal overflow on desktop and at 390 CSS pixels,
  one chat message after an accepted retry, a 390-pixel phone frame, zero
  comment requests from the deterministic preview, and anonymous preview
  refused with 401. The report and the boot log carried no credential or
  machine-specific path.
- The same run exercised: a panel draft surviving a browser reload with its pin
  reattached, a separate tab reading that draft, a second tab draft reflected
  back in the panel after focus, a second session over the same project with
  `Pending (0)`, one simulated delivery rejection that retained both drafts,
  one accepted retry that cleared them, an open-drawer selection with composer
  focus, a phone draft add/remove, return to chat, and the deterministic
  no-comment check.
- Targeted regressions cover: keyboard entry from the focused Comment control,
  arrow-key selection, Enter on a non-focusable structural node, Escape closing
  the composer rather than the drawer, focus restoration, Tab trapped inside
  the review surface while the drawer's modal trap stays intact, structural
  anchors keyed to a rendered-content fingerprint so unchanged content survives
  an idle runtime revision reset while a same-address edit does not reattach,
  stable anchors surviving revisions, hidden targets remaining unanchored,
  screen/state mismatch versus unresolved status, selection-time context capture, the
  50-draft/50-version limit, accepted-version success copy when a draft is
  edited in flight, concurrent same-request-id submissions, later drafts kept
  across replay, retry after an explicit rejection, and a fake-timer/runtime
  regression proving revision 1 is reused after idle eviction while the
  unchanged content fingerprint stays stable.

## Quality gate

```sh
pnpm install
pnpm run check
openspec validate add-design-journeys-and-checks --strict
pnpm run pack:bundle
```

Results:

- `pnpm run check` exits 0: TypeScript build, compile-time type tests, ESLint,
  Prettier, EOF-newline check, and Vitest all pass.
- Vitest: 14 files, 163 tests passed. The real Chromium suites ran (they skip
  only when no browser is available).
- `openspec validate add-design-journeys-and-checks --strict` reports
  `Change 'add-design-journeys-and-checks' is valid`.
- `pnpm run pack:bundle` writes
  `dist/filipeesch-dsh-design-bundle-0.1.0.tgz` (about 1.1 MB; sha256
  `e26c5cbb83650f165dd446475f27a3e925b32102c10e157012ff4aefce77d8cf`). The
  packed manifest declares `playwright-core ^1.65.1`; `lib/host.js` keeps
  `playwright-core` external so the installed profile resolves it.

## Durable coverage added

- Named states: typed extraction, overlay/tab/value validation, duplicate names,
  incompatible or missing targets, cold-invalid and last-valid retention,
  stripped render props.
- Fixtures: bounded JSON loading, unique item ids, flat scalar fields, duplicate
  and missing diagnostics, empty collections, list/table/select normalization,
  key-stable ids across reordering, inline list content preserved, invalid
  binding/conflict diagnostics, deterministic expansion.
- Journeys: typed step parsing, source-located diagnostics for unknown steps,
  expressions, invalid arguments, missing screens/states/targets, duplicate ids,
  browser-free validation.
- Preview: `?state=` deep links, one-time seeding per screen/state transition,
  no reseed on breakpoint changes, history reapplication, unknown-state
  diagnostic, hot-reload reconciliation of rows and owner interaction.
- Browser pool: lazy launch, one shared cold-start launch per session, live and
  in-flight launches counted against the cap, busy/queued sessions never
  evicted, admission/queue/launch cancellation and deadlines, late contexts and
  browsers closed, pending launches drained on session and plugin disposal,
  retiring browser/launch reservations retained until close resolves,
  unlinked retirements drained by `disposeAll`, capacity-only admissions tied to
  session generations (disposing rejects them; fresh work may start a new
  generation), and concurrent cross-session isolation.
- Browser launch: every check passes `chromiumSandbox: true`, reports the
  sandboxed-launch guidance on failure, and never falls back to an unsandboxed
  browser.
- Cache safety: each `.cache` and `screenshots` component is validated before
  creation, symlinks are refused, and the canonical directory is rechecked
  immediately before the atomic write.
- Preflight and actions: invalid screens are rejected before browser work,
  navigation and `ExpectScreen` read the committed canvas, and ordinary
  actionability failures become failed steps with a snapshot.
- Fixture list semantics: each fixture key gets exactly one bare semantic
  `ListItem` wrapper, while repeated row and child identities stay key-derived;
  the installed example reports three listitems.
- Lint: contained sibling rectangles count as overlap unless they are a
  structural parent/child pair or an intentional overlay; snapshot and
  overlap-sample truncation are reported as findings.
- Screenshot identity: resolved state `open`/`tabs`/`values`, viewport height,
  breakpoint width, tokens, assets, locale, time zone, and kit version feed the
  deterministic name, so a changed assignment yields a new path.
- Headless checks: mobile and desktop measured boxes, canvas/container overflow,
  clipped text, peer overlap, 44 px tap targets, intentional overlay and
  ancestor-containment exclusions, passing and failing journeys with
  first-failure snapshots and no later steps, deterministic highlighted
  screenshots confined to `design/.cache/screenshots`, and no writes to design
  sources.
- Tools: all four new tools registered with typed results, deterministic query
  ordering, static inspection and query without a browser, and explicit browser
  unavailability.
- Preset: under the 6,000-character limit, names the new tools and DSL, keeps
  fixtures fictitious, and keeps screenshots and checks opt-in.

## Browser regressions

`packages/renderer/tests/browser.spec.ts` runs a local fixture server and real
Chromium when available. In addition to the foundation scenarios it verifies:

- named-state direct link with drawer, tab, and input seed;
- state retained across a breakpoint change, then reapplied after history
  navigation and a reload;
- explicit unknown-state diagnostic with no state applied;
- fixture-like repeated rows keeping key-derived ids after reorder while an
  entered input value and an open drawer survive compatible hot reloads.

`packages/host/tests/browser.spec.ts` deterministically exercises the pool races:
shared cold launch, cap admission with an in-flight launch, busy/queued
non-eviction, cancellation and deadline at admission/queue/launch, late context
and browser closure, close-gated eviction and late-launch retirement, draining
retirements already unlinked from active records, session-generation rejection
of capacity-only admissions with fresh-generation recovery, disposal draining a
pending launch, and sandboxed launch options.

`packages/host/tests/checks.spec.ts` verifies layout measurements, lint rules
(including contained siblings as overlap, no false overlap for a parent/child
or an open dialog, and truncation reporting), passing and failing journeys,
ordinary actionability failures with snapshots, screenshot determinism and
confinement (including symlinked cache refusal and state-sensitive names),
browser reuse and disposal, static tools without a browser, and the runnable
synthetic example.

## Synthetic example

`examples/synthetic-checkout/design` is a runnable, entirely fictitious project
with named states, List/Table/Select fixtures, and two journeys. In the test run
it loads with zero diagnostics, both journeys pass in real Chromium, and catalog
lint reports zero errors.

```sh
pnpm run check   # includes the example's load, journey, and lint checks
```

## Packed install in a disposable real DSH

A throwaway `DSH_HOME` and workspace were used; the live GUI on port 3080 was
never touched.

```sh
# 1. Create a disposable profile from the shipped web template.
DSH_HOME=<temp-home> node <dsh-checkout>/apps/cli/lib/bin.js \
  --profile <review-profile> --from-default-profile web --dump-config >/dev/null

# 2. Install the packed artifact, not the linked workspace.
DSH_HOME=<temp-home> node <dsh-checkout>/apps/cli/lib/bin.js \
  plugin --profile <review-profile> add <checkout>/dist/filipeesch-dsh-design-bundle-0.1.0.tgz

# 3. Copy the synthetic example and add the disposable session harness.
mkdir -p <temp-workspace>
cp -R <checkout>/examples/synthetic-checkout/design <temp-workspace>/design
REVIEW_PATCH=<temp-workspace>/review.patch.yml
printf '%s\n' \
  '- insert:' \
  '    - id: design-review-session' \
  '      name: <checkout>/docs/review/review-session.mjs' > "$REVIEW_PATCH"

# 4. Boot the real web profile with the review overlay. Set
#    REVIEW_TOOLS_SMOKE=1 to execute the packed tools, and
#    DSH_DESIGN_CHROMIUM_PATH to an installed Chromium.
REVIEW_CWD=<temp-workspace> REVIEW_TOOLS_SMOKE=1 \
  DSH_DESIGN_CHROMIUM_PATH=<chromium-executable> DSH_HOME=<temp-home> \
  node <dsh-checkout>/apps/cli/lib/bin.js --profile <review-profile> \
  --patch "$REVIEW_PATCH" --port <free-port> --no-open
```

The boot log reported:

```text
REVIEW_SESSION review-session design
REVIEW_TOOLS design_catalog,design_init,design_lint,design_query,design_run_journey,design_screenshot,design_status,design_validate,design_view
REVIEW_TOOL design_lint {"errors":0,"warnings":0,"rules":[]}
REVIEW_TOOL design_run_journey {"ok":true,"steps":10}
REVIEW_TOOL design_screenshot {"width":390,"bytes":40611,"cachePath":true}
REVIEW_TOOL design_view {"breakpoint":"mobile","canvas":{"width":390,"height":723},"nodes":23}
REVIEW_TOOL design_query {"total":1,"node":"open-cart"}
REVIEW_TOOLS_SMOKE done
```

So the packed install boots the real web profile, the design preset is
available, all nine design tools are registered, and the browser-backed plus
static tools execute against the synthetic example. The packed dependency
resolved to `playwright-core 1.65.1` inside the profile. Running the same smoke
once without a configured Chromium returned the explicit missing-browser/sandbox
guidance; pointing `DSH_DESIGN_CHROMIUM_PATH` at an installed Chrome for Testing
made every browser-backed tool pass.

```sh
# Owner gating: no cookie is refused before content is read.
curl -s -o /dev/null -w '%{http_code}\n' <origin>/design/review-session/catalog
# 401
```

The owner-link browser review (the printed entry URL contains a token and is not
recorded) used:

```sh
DSH_ENTRY_URL='<printed owner entry URL>' REVIEW_SESSION=review-session \
  node <checkout>/docs/review/preview-check.mjs
```

Output (abridged):

```json
{
  "mobile": { "breakpoint": "mobile", "width": 390, "screen": "catalog" },
  "desktop": {
    "breakpoint": "desktop",
    "width": 1280,
    "screen": "catalog",
    "requests": ["<origin>/design/review-session/catalog?bp=desktop&deterministic=1"]
  },
  "stated": { "breakpoint": "mobile", "width": 390, "screen": "checkout" },
  "failures": []
}
```

Manual observations on the same disposable instance:

- mobile interactive catalog: 390 px canvas, three semantic listitems, fixture
  list rows and table visible;
- desktop deterministic catalog: 1280 px canvas, exactly one network request,
  owner chrome shows `deterministic`;
- `/checkout?bp=mobile&state=review-open`: review drawer open, email seeded to
  `ada@example.com`, plan seeded to `pro`, shell reports the state;
- owner screenshots showed the same rendering; the mobile and desktop captures
  were byte-identical to the pre-fix run, so the semantic listitem wrapper did
  not change the accepted UI. Anonymous access returned 401.

## Install workflows

Reproducible machine flow (clone, install, build, pack, install):

```sh
git clone <repository> <checkout>
cd <checkout>
pnpm install
pnpm run check
pnpm run pack:bundle
dsh plugin --profile <fresh-profile> add <checkout>/dist/filipeesch-dsh-design-bundle-0.1.0.tgz
```

The non-link path installs the packed local artifact. Browser-backed tools need
a Playwright Chromium matching the installed `playwright-core`, or an operator
path:

```sh
pnpm exec playwright install chromium
# or
export DSH_DESIGN_CHROMIUM_PATH=/path/to/chrome
```

Without one, preview, static validation, `design_view` without a breakpoint, and
`design_query` keep working, while browser-backed tools return the explicit
install guidance covered by tests.

## Cleanup

The disposable server, temp home, temp workspace, review patch, and screenshots
were removed after the run; the live GUI and DSH checkout were never modified.
