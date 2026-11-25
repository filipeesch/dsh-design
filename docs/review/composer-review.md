# Anchored comment composer review

Repeatable browser review for `anchor-design-comment-composer` against a
disposable DSH profile and the packed bundle. It never touches the live GUI on
port 3080 or the DSH source checkout. Paths below are placeholders, and the
owner entry URL (which contains a token) is never recorded.

## What the review covers

- The composer opens as a balloon beside the selected component with a pointer,
  inside the visible preview pane, without reflowing the canvas.
- The balloon stays compact in the narrow native Design sidebar and at the
  Mobile preview breakpoint selected from a desktop browser.
- A saved pin reopens the balloon at the same component, with focus and Escape
  restoring the review surface without closing the drawer.
- Two drafts still deliver as exactly one chat message, and deterministic
  rendering has no review controls and makes no comment request.
- An open drawer at the Mobile canvas keeps the balloon beside its target and
  the canvas geometry unchanged.
- Moving an open editor to another screen, state or variant, or replacing a
  structural target's content, detaches the balloon with its text preserved;
  returning to the original anchor reattaches it. Pending never shows a false
  pin for those drafts.
- A short native pane draws the arrow only when the balloon cannot cover its
  target; with no usable non-overlapping side the editor is pointerless and
  keeps its text. The same anchor rules apply to new and reopened editors.

The renderer suites separately cover edge flipping, scroll and resize
recomputation, live anchor replacement, comparison panes, and unavailable
drafts. This review exercises the same behavior through the installed plugin in
a real DSH session.

## Prerequisites

- A DSH checkout with `apps/cli/lib/bin.js` already built.
- This repository installed, checked, and packed:
  `pnpm install && pnpm run check && pnpm run pack:bundle`.
- A Chromium executable for Playwright, for example from
  `pnpm exec playwright install chromium`.

## 1. Create a disposable profile and workspace

```sh
temp=$(mktemp -d <temp-root>/dsh-composer-review.XXXXXX)
mkdir -p "$temp/home" "$temp/workspace"
cp -R <checkout>/examples/synthetic-checkout/design "$temp/workspace/design"

DSH_HOME="$temp/home" node <dsh-checkout>/apps/cli/lib/bin.js \
  --profile review --from-default-profile web --dump-config >/dev/null

DSH_HOME="$temp/home" node <dsh-checkout>/apps/cli/lib/bin.js \
  plugin --profile review add <checkout>/dist/filipeesch-dsh-design-bundle-0.1.0.tgz
```

The `review` profile is local to `temp/home`; the synthetic project is
entirely fictitious.

## 2. Boot with the review harness

`docs/review/panel-review-session.mjs` registers the disposable workspace and
creates the `review-a` and `review-b` Design sessions. No model credential is
needed; the seeded setup message records a missing credential, which only makes
the sessions appear in the workspace list.

```sh
printf '%s\n' \
  '- insert:' \
  '    - id: design-panel-review-session' \
  '      name: <checkout>/docs/review/panel-review-session.mjs' \
  > "$temp/composer-review.patch.yml"

REVIEW_CWD="$temp/workspace" DSH_HOME="$temp/home" \
  node <dsh-checkout>/apps/cli/lib/bin.js --profile review \
  --patch "$temp/composer-review.patch.yml" --port <free-port> --no-open
```

Use a free loopback port other than 3080. The boot log should include
`REVIEW_WORKSPACE`, two `REVIEW_SESSION ... seeded` lines, and
`REVIEW_READY`. Keep the printed owner entry URL only in the terminal or an
ephemeral variable.

## 3. Run the browser review

```sh
DSH_ENTRY_URL='<printed owner entry URL>' \
DSH_DESIGN_CHROMIUM_PATH='<chromium-executable>' \
  node <checkout>/docs/review/composer-check.mjs
```

A passing run prints `ok: true`, an empty `failures` list, and evidence such
as:

```json
{
  "ok": true,
  "failures": [],
  "evidence": {
    "desktop panel opens an anchored balloon": "bottom",
    "desktop panel keeps a compact editor, not a footer": 360,
    "desktop panel places the balloon beside its target": "bottom",
    "desktop panel leaves the canvas geometry unchanged": 1280,
    "desktop panel adds exactly one pending draft": 1,
    "desktop panel pin reopens the balloon with its text": true,
    "desktop panel Escape closes the balloon and restores pin focus": true,
    "batch delivery records exactly one chat message": 1,
    "mobile canvas keeps its exact width": 390,
    "drawer target at the mobile canvas opens an anchored balloon": "right",
    "drawer balloon stays beside its target inside the mobile pane": "right",
    "short native pane draws an arrow only without covering the email target": "bottom",
    "short native pane keeps the text while the pointer is dropped": true,
    "deterministic preview makes no comment request": 0
  }
}
```

## Manual checks on the same instance

1. **Desktop panel.** Open **Review A**, choose **Design**, select **checkout**,
   and choose **Comment**. Click the Email field: the editor appears beside the
   field with a pointer, not as a footer, and the canvas does not move.
2. **Pin reopen.** Save, then click the pin. The balloon reopens with the saved
   text and focuses the field; Escape closes it and returns focus to the pin
   without closing an open drawer.
3. **Mobile canvas on the desktop browser.** Choose **mobile 390px**, open the
   **Order review** drawer, and comment on **Keep editing**. The balloon stays
   beside that button inside the 390-pixel canvas.
4. **Narrow sidebar and short pane.** Resize the GUI so the native Design
   sidebar is narrow; the balloon remains compact inside the visible pane
   instead of stretching to a footer. At about 1050x420 the native pane is
   short: the arrow must never cover the Email field. If no side has room, the
   editor stays pointerless and keeps its text.
5. **Navigation while editing.** With an editor open, switch to another screen,
   open another named state, or let a structural target's content change. The
   arrow disappears, the text stays, and no pin appears for that draft; return
   to the original anchor and the editor reattaches.
6. **Pending.** Open **Pending**, edit a draft whose screen is not current, and
   confirm it stays editable with a visible unavailable-target message and no
   pointer.
7. **Batch and deterministic.** Send two drafts and confirm one chat message;
   open `?deterministic=1` and confirm no comment controls or requests.

## Cleanup

Stop the disposable server, then remove `"$temp"`, the profile copy, the review
patch, and any temporary screenshots. The live GUI on 3080 and the DSH checkout
are not modified by this review.
