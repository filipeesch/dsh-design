# Verification evidence

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
