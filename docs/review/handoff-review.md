# Handoff review

Repeatable real-DSH review for the standalone `design_handoff` path. It runs the
packed bundle in a disposable profile on a free loopback port other than 3080,
with a synthetic design workspace. It does not touch the live GUI, the DSH
implementation checkout, any real app, or the network.

Only ordinary functional checks and defensive review are performed. No model
prompt is sent: the harness creates Design and standard sessions and calls tools
directly.

## What the review covers

- The packed Design preset exposes `design_handoff`; neither preset exposes
  `design_capture`.
- No capture source files, settings, operator configuration, or capture tool
  registration are present in the packed artifact.
- Mobile-only and Desktop-only handoff selections, with generated support
  closures and full breakpoint support.
- Fresh-workspace reopen with zero `design_validate` errors and passing
  applicable journeys in real Chromium.
- Deterministic same-id and byte-identical output for reruns and a second
  synthetic workspace.
- Cache ignore, cache cancellation/partial-publication behavior, and no
  completed artifact on cancellation.
- Real browser Desktop and Mobile preview layout simulation.

## Prerequisites

- A DSH checkout with `apps/cli/lib/bin.js` already built.
- This repository installed, checked, and packed:
  `pnpm install && pnpm run check && pnpm run pack:bundle`.
- A Chromium executable for Playwright.

## 1. Check the packed artifact scope

```sh
bundle=dist/filipeesch-dsh-design-bundle-0.1.0.tgz
list=$(tar -tzf "$bundle") || exit 1
if printf '%s\n' "$list" | grep -E '(^|/)capture(-[a-z-]+)?\.(ts|js|d\.ts)(\.map)?$'; then
  echo 'capture source file in bundle' >&2
  exit 1
fi
runtime=$(tar -xOzf "$bundle" package/package.json package/cordis.patch.yml \
  package/lib/host.js package/lib/tools.js package/lib/preset.js) || exit 1
if printf '%s\n' "$runtime" | grep -E 'design_capture|captureOrigins|captureTimeoutMs|DSH_DESIGN_CAPTURE_ORIGINS'; then
  echo 'capture tool or setting in bundle' >&2
  exit 1
fi
```

The artifact must contain no capture source, tool name, or operator setting.
The harness also checks the effective tool lists in both presets.

## 2. Create a disposable workspace

```sh
temp=$(mktemp -d <temp-root>/dsh-handoff-review.XXXXXX)
mkdir -p "$temp/home" "$temp/workspace"
cp -R <checkout>/examples/synthetic-checkout/design "$temp/workspace/design"

DSH_HOME="$temp/home" node <dsh-checkout>/apps/cli/lib/bin.js \
  --profile review --from-default-profile web --dump-config >/dev/null

DSH_HOME="$temp/home" node <dsh-checkout>/apps/cli/lib/bin.js \
  plugin --profile review add <checkout>/dist/filipeesch-dsh-design-bundle-0.1.0.tgz
```

## 3. Boot with the handoff harness

```sh
printf '%s\n' \
  '- insert:' \
  '    - id: design-handoff-review-session' \
  '      name: <checkout>/docs/review/handoff-review-session.mjs' \
  > "$temp/handoff-review.patch.yml"

REVIEW_CWD="$temp/workspace" DSH_HOME="$temp/home" \
DSH_DESIGN_CHROMIUM_PATH='<chromium-executable>' \
  node <dsh-checkout>/apps/cli/lib/bin.js --profile review \
  --patch "$temp/handoff-review.patch.yml" --port <free-port> --no-open
```

Use a free loopback port other than 3080. Keep the printed owner entry URL only
in the terminal or an ephemeral variable; it contains a token and is never
recorded. The boot log should include:

- `REVIEW_TOOLS` with `design_handoff` in the Design session and no
  `design_capture` or design tools in the standard session;
- `REVIEW_HANDOFF` with Mobile `review-open` and Desktop `$default` packages,
  supporting screens, full support breakpoints, cache-relative paths, no capture
  data, and no absolute workspace path;
- `REVIEW_REPRODUCIBLE` with reused/same-id/same-file and other-workspace
  identity true;
- `REVIEW_REOPEN_MOBILE` and `REVIEW_REOPEN_DESKTOP` with zero errors and all
  journeys passing;
- `REVIEW_CACHE_IGNORE` with `cacheIgnored: true`;
- `REVIEW_READY`.

## 4. Run the browser layout QA

```sh
DSH_ENTRY_URL='<printed owner entry URL>' \
REVIEW_CWD="$temp/workspace" \
DSH_DESIGN_CHROMIUM_PATH='<chromium-executable>' \
  node <checkout>/docs/review/handoff-check.mjs
```

A passing run prints `ok: true`, an empty `failures` list, and evidence such
as desktop canvas 1280 in a 1440 document, Mobile canvas 390 in a 390 document,
the review drawer open at both widths, matching handoff layout/PNG widths, two
handoff packages, and `captureCacheAbsent: true`.

## Manual checks

1. **Desktop layout.** Open the **Handoff Review** session, open **Design**, and
   select checkout at `desktop 1280px`. The review drawer opens with the seeded
   email and the page does not scroll horizontally.
2. **Mobile layout.** Resize to 390x844 CSS pixels, reopen **Design**, and select
   `mobile 390px`. The canvas is exactly 390 CSS pixels and the drawer/email
   remain.
3. **Reopen unchanged.** Copy each package into a fresh workspace as
   `design/`, open a Design session, and run `design_validate` plus each
   manifest journey. Both Mobile-only and Desktop-only packages must validate
   with zero errors and pass the applicable journeys.
4. **Cache ignore.** Confirm `design/.gitignore` contains `.cache/` and
   `git check-ignore` reports the handoff manifest. No capture directory exists.
5. **No preset change.** Start a normal coding session in the same profile and
   confirm it has no `design_handoff` or `design_capture` tool.
6. **Cancellation.** The cache unit suite covers pre-call and late cancellation
   and concurrent same-id publication; no completed artifact remains.
7. **Reproducibility.** Same selection in the same and a second workspace
   produces the same id and bytes.

## Cleanup

Stop the disposable server, then remove `"$temp"`, the profile copy, the review
patch, and any temporary screenshots. The live GUI on 3080 and the DSH
implementation checkout are never modified.

## Evidence

Recorded in [`docs/verification.md`](../verification.md).
