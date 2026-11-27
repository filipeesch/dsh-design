# Variants review

Repeatable browser and packed-install review for the variant change. It uses a
disposable DSH profile and a copy of the fictitious
`examples/synthetic-variants` project. It never touches the live GUI on port
3080 or the private DSH checkout, and it records no owner token, session
credential, or machine-specific path.

## What is covered

- Chosen projection versus an explicit alternate deep link.
- Side-by-side comparison at desktop and 390 CSS pixels with exact canvas
  widths and no page-wide overflow.
- Independent pane fields and drawers, isolated modal focus, and
  keyboard-scrollable comparison on a narrow host.
- A shared starting-state change reseeding both panes, and clearing it to
  default resetting both drawers and seeded values.
- Shared-control changes returning both panes to the parent screen after one
  pane navigated internally; Back restoring the comparison; compatible SSE
  refresh preserving local interaction.
- Invalid alternate edits keeping the last valid comparison pane with a
  diagnostic label and recovering in place; initially invalid panes mounting
  after repair without a URL change.
- Malformed or unknown variant, comparison, and state links staying explicit
  instead of rendering a chosen/default projection.
- Retained-only projects after structural failure: status marks every retained
  branch stale and view/query/diff/screenshot fail with current diagnostics,
  then recover after repair.
- Inactive nested defaults rendering the prior valid body with diagnostics
  after an invalid edit, good siblings staying usable, and repair recovering.
- A comment on a stable id shared by both panes pinning only its branch and
  remaining in the session queue with its variant context.
- Comparison history restoring both the URL and the panes.
- Deterministic preview remaining a single self-contained canvas with no
  comment UI or comment requests.
- `design_diff` branch results, unknown-selection diagnostics, and no Chromium
  requirement for semantic diff.
- `design/.discarded/` and `design/.cache/` excluded from discovery and Git,
  plus an owner-requested cleanup and promotion drill.
- Owner admission refusing anonymous preview access before content.

This is defensive functional review only: no exploit development or
reproduction.

## Prerequisites

- A DSH checkout with `apps/cli/lib/bin.js` already built.
- This repository installed and built: `pnpm install && pnpm run pack:bundle`.
- A Chromium executable for Playwright, for example from
  `pnpm exec playwright install chromium`.

## 1. Build and validate

```sh
cd <checkout>
pnpm install
pnpm run check
openspec validate add-design-variants --strict
pnpm run pack:bundle
```

The artifact is `<checkout>/dist/filipeesch-dsh-design-bundle-0.1.0.tgz`.

## 2. Create a disposable profile and synthetic workspace

```sh
temp=$(mktemp -d <temp-root>/dsh-variants-review.XXXXXX)
mkdir -p "$temp/home" "$temp/workspace"
cp -R <checkout>/examples/synthetic-variants/design "$temp/workspace/design"

# Synthetic local artifacts: one ignored discard record and one cache file.

mkdir -p "$temp/workspace/design/.discarded" "$temp/workspace/design/.cache"
printf '%s\n' '<Screen id="rejected"><Text>Never discovered</Text></Screen>' > "$temp/workspace/design/.discarded/rejected.dsx"
printf '%s\n' 'stale cache artifact' > "$temp/workspace/design/.cache/stale.txt"

# Make the copy a throwaway Git repository and prove both artifacts are ignored.

git -C "$temp/workspace" init -b main >/dev/null
git -C "$temp/workspace" add -A
git -C "$temp/workspace" -c user.email=review@example.invalid \
-c user.name=Review commit -m 'synthetic variants review' >/dev/null
git -C "$temp/workspace" check-ignore -v \
design/.discarded/rejected.dsx design/.cache/stale.txt

DSH_HOME="$temp/home" node <dsh-checkout>/apps/cli/lib/bin.js \
--profile review --from-default-profile web --dump-config >/dev/null

DSH_HOME="$temp/home" node <dsh-checkout>/apps/cli/lib/bin.js \
plugin --profile review add \
<checkout>/dist/filipeesch-dsh-design-bundle-0.1.0.tgz
```

The two `check-ignore` lines must report the `.discarded/` and `.cache/` rules.

## 3. Boot the packed install with the review harness

```sh
printf '%s\n' \
  '- insert:' \
  '    - id: design-variants-review-session' \
  '      name: <checkout>/docs/review/variants-review-session.mjs' \
  > "$temp/variants-review.patch.yml"

REVIEW_CWD="$temp/workspace" REVIEW_TOOLS_SMOKE=1 \
DSH_DESIGN_CHROMIUM_PATH='<chromium-executable>' DSH_HOME="$temp/home" \
  node <dsh-checkout>/apps/cli/lib/bin.js --profile review \
  --patch "$temp/variants-review.patch.yml" --port <free-port> --no-open
```

Keep the printed owner entry URL only in the terminal or an ephemeral variable.
The boot log should include:

```text
REVIEW_WORKSPACE <workspace-id>
REVIEW_TOOLS design_catalog,design_diff,design_init,design_lint,design_query,design_run_journey,design_screenshot,design_status,design_validate,design_view
REVIEW_VARIANTS {"screens":1,"variants":[{"screen":"catalog","id":"layout","path":"layout","chosen":"compact","branches":[{"id":"compact","valid":true,"stale":false,"errors":0},{"id":"spacious","valid":true,"stale":false,"errors":0}]}]}
REVIEW_VARIANT_VIEW {"chosen":true,"alternate":true,"alternateVariant":{"group":"layout","path":"layout","branch":"spacious","chosen":false}}
REVIEW_VARIANT_QUERY {"total":1,"variant":{"group":"layout","path":"layout","branch":"spacious","chosen":false}}
REVIEW_VARIANT_SCREENSHOTS {"distinct":true,...}
REVIEW_VARIANT_DIFF {"ok":true,"moves":[{"node":"checkout","reason":"parent"}],"changes":[{"node":"checkout","kind":"text","after":"Continue"}]}
REVIEW_DISCARD_IGNORED {"screens":["catalog"],"discarded":false}
REVIEW_READY
```

The exact JSON key order may differ; the assertions are that only `catalog` is
discovered, both branches are valid, screenshots are distinct, and the diff
reports the stable `checkout` move and label change. If Chromium is unavailable,
the screenshot step reports the documented missing-browser guidance; rerun with
`DSH_DESIGN_CHROMIUM_PATH` set.

## 4. Run the browser review

```sh
DSH_ENTRY_URL='<printed owner entry URL>' \
DSH_DESIGN_CHROMIUM_PATH='<chromium-executable>' \
  node <checkout>/docs/review/variants-check.mjs
```

A passing run prints:

```json
{
  "ok": true,
  "failures": [],
  "evidence": {
    "chosen route renders the compact branch": true,
    "alternate desktop canvas is exactly 1280 CSS pixels": 1280,
    "phone left pane keeps 390 CSS pixels": 390,
    "phone comparison is keyboard scrollable": 12,
    "draft context records the effective branch": "layout:spacious",
    "deterministic preview makes exactly one request": 1,
    "anonymous preview is refused": 401
  }
}
```

## 5. Manual checks on the same instance

1. **Chosen versus alternate.** Open
   `<origin>/design/variants-review/catalog?bp=desktop` and then
   `?variant=layout:spacious`. The chrome badge names the branch and whether it
   is chosen; the chosen source is unchanged.
2. **Comparison.** Open
   `?compare=layout:compact:spacious&bp=mobile`. Both panes render at 390 CSS
   pixels, the page itself does not scroll horizontally, and the comparison
   region scrolls with arrow keys.
3. **Isolation.** Open Filters in the left pane only. Type in the right search
   field; the left field stays empty. Focus stays inside the drawer's document
   until it is closed.
4. **Shared state.** Choose **Starting state → filters-open** in the
   comparison header; both panes show the drawer and seeded search value.
   Choose **default**; both drawers close and both fields clear. Change the
   right branch after navigating the left pane to another screen; both panes
   return to the parent screen. A valid SSE refresh keeps local interaction.
5. **Invalid alternate.** Make one branch invalid without changing the
   comparison URL: its pane keeps the last valid render with the
   `last valid · diagnostics` label. Repair it; the pane recovers. A branch
   that was invalid from the start mounts after repair.
6. **Comment.** In the right pane choose **Comment**, select the checkout
   control, save, and confirm one pin in the right pane and none in the left.
   Inspect `/design/variants-review/_/comments`: the draft names
   `layout:spacious`. Clear it through the review API after the check.
7. **History.** Change the right branch selector, then use browser Back. The
   URL and both panes return to the previous comparison.
8. **Malformed links.** Open `?variant=broken`, `?compare=broken`, and
   `?compare=layout:compact:spacious&state=ghost`. Each shows an explicit
   diagnostic and does not silently render the chosen/default screen.
9. **Deterministic.** Open `?deterministic=1`. It has no Comment or Pending
   controls, makes one request, and renders one canvas.
10. **Diff.** Inspect the boot log's `REVIEW_VARIANT_DIFF`. It identifies the
    stable `checkout` move and the text change without claiming a removal and
    addition. `design_diff` also returns actionable diagnostics for an unknown
    branch.
11. **Discard and cache.** `REVIEW_DISCARD_IGNORED` lists only `catalog`.
    `git check-ignore` names both rules, and neither artifact appears in
    discovery or default inspection.
12. **Owner fence.** Request the same preview without the owner session; the
    host refuses it before serving project content.
13. **Promotion drill (optional).** In the disposable workspace, replace the
    `<Variants>` block with the spacious children using ordinary text edits,
    reload, and confirm the chosen projection is now spacious while unrelated
    source remains. Then remove `design/.discarded` only, and confirm
    `design/screens/catalog.dsx` is unchanged.

## Cleanup

Stop the disposable server, then remove `"$temp"`, the profile copy, the review
patch, and any temporary screenshots. The live GUI on 3080 and the DSH checkout
are not modified by this review.
