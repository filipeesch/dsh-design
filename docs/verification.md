# Verification evidence

Checks run while implementing `add-design-journeys-and-checks` on top of the
`add-design-foundation` baseline. Paths are portable placeholders; no owner
token, real session id, temporary home, or machine-specific path is recorded.

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
