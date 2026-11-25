# Verification evidence

Checks run while implementing and reworking `add-design-foundation`. Paths are
portable placeholders; machine-local sample data is not part of the repository.

## Quality gate

```sh
pnpm install
pnpm -r build
pnpm -r test
pnpm run check
openspec validate add-design-foundation --strict
```

`pnpm -r build` and `pnpm -r test` exit 0. `pnpm run check` (TypeScript build,
compile-time type tests, ESLint, Prettier, EOF-newline check, Vitest) passes.
`openspec validate --strict` reports `Change 'add-design-foundation' is valid`.

## Durable test coverage

- parser allowlist, rejected JavaScript corpus, untouched-evaluation check;
- validation rules, suggestions, CSS/image policy, responsive values, interactions;
- tokens, aliases, cycles, config defaults, duplicate screens, kit pin, fatal
  parse identity, cold-invalid -> invalid -> valid retention using only a
  previously validated `lastValidRoot`;
- scaffolding refusal inside `scaffoldProject` before side effects, exclusive
  config claim, child-directory validation before the claim, exclusive open
  separated from write with immediate ownership registration, rollback of
  partially written config and sibling files, closed handles, injected-I/O
  failure retry, screens-conflict retry, concurrent-call winner,
  symlink-folder rejection, no-write on existing config, configured folder
  names and safe-segment confinement;
- kit metadata for every component, example rendering, semantic roles, classes;
- tab/select/toggle/drawer behavior, backdrop, Escape, focus restoration;
- modal focus trapping at phone and desktop, background focus rejection, and
  focus after reload;
- preview route source, deep links, Back/Forward, breakpoint URLs;
- state filtering and error overlay; project-level render blocking;
- host owner-principal denial (403), owner path, passive media allowlist,
  signature sniffing, traversal/symlink confinement, assets separation;
- project registry sharing, two repositories, revision counter, parse cache;
- tools `design_init/status/validate/view/catalog`, configured folder,
  effective cwd, existing-config no-write;
- automatic validation for edit/write/shell and nested `run_code` aggregation;
- preset prompt size and standard-composition drift with `DSH_CHECKOUT`;
- activation diagnostic when `webServer` is unavailable;
- static renderer references only relative resources;
- real Chromium regressions for mobile/desktop geometry, Back/Forward, deep
  links, focus, overlay confinement, visible node CSS, bundled font,
  deterministic self-contained delivery and fatal break/repair.

## Real Chromium regression

`packages/renderer/tests/browser.spec.ts` starts a local fixture server and
launches Chromium when a Playwright browser is available (skip otherwise). It
verifies:

- 390x844 viewport: canvas exactly 390 px, document scroll width <= 390 px;
- 1440x900 viewport: desktop canvas exactly 1280 px; mobile canvas on desktop;
- deep link `/design/<session>/checkout?bp=mobile`, Back, Forward, and the
  breakpoint picker agree;
- named drawer: `aria-labelledby` points at the title, focus moves inside,
  Tab/Shift+Tab stay in the top dialog, background focus is rejected, dialog
  bounds stay inside `.dsx-frame`, Escape closes, focus returns to the trigger;
- the same modal trap at 390x844 and 1440x900 and after a reload;
- node `css` produces visible `border-left: 4px` in computed style;
- fatal payload (no current root, retained `lastValidRoot`) keeps the previous
  render and open drawer; repair removes the overlay;
- deterministic mode: the initial document is the only Chromium request; its
  project state, renderer, fonts, and raster image are inlined; screen changes
  and drawer interaction add no requests; identical markup and all element
  rects on two loads; bundled Inter available via `document.fonts.check`; fixed
  clock attribute `1700000000000`; CSP contains `connect-src 'none'`.

## Real DSH and browser E2E

A temporary DSH home/profile was used; the running GUI on port 3080 was never
touched.

- Owner-authenticated preview loaded; anonymous request returned 401;
- design session called `design_status` and returned its preview URL;
- mobile canvas 390 px, page scroll checked in a real 390x844 context by the
  browser suite;
- node CSS computed `4px rgb(255, 0, 0)`; bundled font reported loaded;
- drawer focus was inside the dialog, Tab stayed inside the top modal, and the
  dialog stayed inside the canvas;
- deterministic preview on the real host returned one self-contained document:
  the Chromium request log contained only that document, CSP was
  `connect-src 'none'`, the clock attribute was `1700000000000`, bundled Inter
  was available, and opening the drawer added no request;
- breaking `checkout.dsx` with an unclosed tag kept the previous render and the
  open drawer, with `Showing the last valid render`; repairing it cleared the
  overlay and kept the drawer;
- client activation marker `documentElement.dataset.dshDesignClient = "loaded"`
  was present; no dead sidebar action is registered.

## Install workflows

Linked development checkout:

```sh
pnpm install
pnpm run build
dsh plugin --profile <profile> add link:<checkout>/packages/bundle
# start DSH: /design/* -> 401 without owner
dsh plugin --profile <profile> remove @filipeesch/dsh-design-bundle
# start DSH: /design/* -> 404, design rows gone
```

Reproducible machine flow (clone -> install -> build -> pack -> install the local artifact):

```sh
git clone <repository> <checkout>
cd <checkout>
pnpm install
pnpm run build
pnpm run pack:bundle
dsh plugin --profile <fresh-profile> add <checkout>/dist/filipeesch-dsh-design-bundle-0.1.0.tgz
# activation verified through a fresh profile; removal verified the same way
```

Both paths were exercised on fresh profiles in this run. The non-link path
installs the packed local artifact; no direct Git URL install is claimed. No
release was published.

## Opening the preview for review

```sh
cd <target-app-with-design-folder>
DSH_HOME=<dsh-home> <dsh-checkout>/apps/cli/bin.js \
  --profile <profile-with-dsh-design> --port 3091 --no-open
```

Open the printed entry URL once with its `?token=` to set the owner cookie. In
the DSH GUI create/open a **Design** session; use the preview URL it returns:

```text
http://127.0.0.1:3091/design/<session-id>/
http://127.0.0.1:3091/design/<session-id>/<screen-id>?bp=mobile
http://127.0.0.1:3091/design/<session-id>/<screen-id>?bp=desktop&deterministic=1
```

The route is owner-only and local by design; do not expose the port.
