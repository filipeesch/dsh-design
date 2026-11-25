# Design panel and comment review

This is the repeatable browser review for `add-design-panel-and-comments`. It
runs against a disposable DSH profile and the packed bundle; it never touches the
live GUI or the DSH source checkout. Paths below are placeholders, and the owner
entry URL (which contains a token) is never recorded.

## What the review covers

- The native session-scoped **Design** tab and its session header action.
- A titled same-origin preview frame, the separate-tab link, and return to chat.
- Desktop and 390 CSS pixel layouts without page-wide horizontal overflow.
- Panel and separate-tab drafts sharing one session's host store.
- A second session over the same project keeping its own pending drafts.
- Rejected batch delivery keeping drafts, then one accepted retry that records
  exactly one chat message.
- An open drawer's component selection and composer focus.
- Deterministic previews with no comment controls and no comment requests.
- Anonymous preview access refused before content is read.
- A pending draft surviving a browser reload, with the pin reattached.
- Keyboard entry, arrow-key selection, a non-focusable structural node, Escape
  semantics, focus restoration, and the drawer's focus trap while composing.
- Stable anchors surviving a revision change while structural anchors carry a
  rendered-content fingerprint: unchanged content survives an idle runtime
  revision reset, a same-address edit does not, and hidden targets stay
  unanchored.
- The 50-draft live limit matching the 50-version batch limit.

Only ordinary functional checks and defensive review are performed. No exploit
development or reproduction is part of this review.

## Prerequisites

- A DSH checkout with `apps/cli/lib/bin.js` already built.
- This repository installed and built: `pnpm install && pnpm run pack:bundle`.
- A Chromium executable for Playwright, for example from
  `pnpm exec playwright install chromium`.

## 1. Build the artifact

```sh
cd <checkout>
pnpm install
pnpm run check
pnpm run pack:bundle
```

The artifact is `<checkout>/dist/filipeesch-dsh-design-bundle-0.1.0.tgz`.

## 2. Create a disposable profile and workspace

```sh
temp=$(mktemp -d <temp-root>/dsh-panel-review.XXXXXX)
mkdir -p "$temp/home" "$temp/workspace"
cp -R <checkout>/examples/synthetic-checkout/design "$temp/workspace/design"

DSH_HOME="$temp/home" node <dsh-checkout>/apps/cli/lib/bin.js \
  --profile review --from-default-profile web --dump-config >/dev/null

DSH_HOME="$temp/home" node <dsh-checkout>/apps/cli/lib/bin.js \
  plugin --profile review add \
  <checkout>/dist/filipeesch-dsh-design-bundle-0.1.0.tgz
```

`review` is a custom profile name; `web` is the shipped template it copies.
The synthetic project is entirely fictitious.

## 3. Boot with the two-session review harness

`docs/review/panel-review-session.mjs` registers the disposable workspace,
creates the `review-a` and `review-b` Design sessions, and seeds each session
with one setup message (without a model, DSH records the message and reports a
missing credential; that is expected and only makes the sessions appear in the
workspace list). The first submitted design-comment batch is rejected once so the
panel's recovery path can be exercised.

```sh
printf '%s\n' \
  '- insert:' \
  '    - id: design-panel-review-session' \
  '      name: <checkout>/docs/review/panel-review-session.mjs' \
  > "$temp/panel-review.patch.yml"

REVIEW_CWD="$temp/workspace" REVIEW_REJECT_FIRST=1 DSH_HOME="$temp/home" \
  node <dsh-checkout>/apps/cli/lib/bin.js --profile review \
  --patch "$temp/panel-review.patch.yml" --port <free-port> --no-open
```

Keep the printed owner entry URL only in the terminal or an ephemeral variable.
The boot log should include `REVIEW_WORKSPACE`, two `REVIEW_SESSION ... seeded`
lines, and `REVIEW_READY`.

## 4. Run the browser review

```sh
DSH_ENTRY_URL='<printed owner entry URL>' \
DSH_DESIGN_CHROMIUM_PATH='<chromium-executable>' \
  node <checkout>/docs/review/panel-check.mjs
```

A passing run prints a report like:

```json
{
  "ok": true,
  "failures": [],
  "evidence": {
    "desktop panel width leaves room for preview": 647,
    "desktop page has no horizontal overflow": 0,
    "retry records exactly one chat message": 1,
    "phone panel fits the viewport": 390,
    "phone page has no horizontal overflow": 0,
    "deterministic preview makes no comment request": 0,
    "anonymous preview is refused": 401
  }
}
```

The widths depend on the host sidebar preference; the assertions are that the
desktop frame leaves usable preview room, the phone frame fits 390 CSS pixels,
and neither document scrolls horizontally.

## Manual checks on the same instance

1. **Desktop, panel beside chat.** Open the **Review A** session, select
   **Design** in the session header, and confirm the conversation and the
   interactive catalog are visible together. The panel header offers
   **Open in tab** and **Back to chat**.
2. **Panel draft.** In the preview chrome choose **Comment**, click a product
   row, write a comment, and save. A numbered pin appears and **Pending**
   increments. Open the same session's standalone preview in another tab and
   confirm the draft is listed there after focus.
3. **Two sessions.** Select **Review B**, open **Design**, and confirm
   **Pending (0)** while the catalog is the same project.
4. **Reload.** Reload the page, reopen **Review A** and **Design**, and confirm
   the pending draft and its pin return. Browser reload is not DSH session
   disposal.
5. **Rejected delivery.** Return to **Review A**, open **Pending**, and choose
   **Send**. The single simulated rejection keeps both drafts and shows a
   recoverable error. Choose **Send** again: the drafts and pins disappear and
   the chat transcript contains exactly one message beginning
   `Design review comments (2 comments).`.
6. **Phone.** Resize the GUI to 390x844 CSS pixels, reopen **Design** from the
   header, choose the **mobile** breakpoint, add and remove a draft with the
   comment controls, and use **Back to chat**. The page must not scroll
   horizontally.
7. **Deterministic.** Open
   `<origin>/design/review-a/catalog?deterministic=1` in a normal tab. It has no
   **Comment** or **Pending** controls and makes no `_/comments` request.
8. **Owner fence.** Request the same preview from a context without the owner
   session; the host refuses it before serving project content.

## Evidence recorded for this change

- `pnpm run check` passed: build, type tests, ESLint, Prettier, EOF check, and
  the full Vitest suite (221 tests, including real Chromium regressions).
- `openspec validate add-design-panel-and-comments --strict` reported the
  change is valid.
- `pnpm run pack:bundle` produced
  `dist/filipeesch-dsh-design-bundle-0.1.0.tgz` with the SHA-256 recorded in
  `docs/verification.md`.
- The packed artifact (sha256
  `17b9ae3c0ef330d7096cce3fb486b5fbd20346fdf5767bc465e65bb433145bd2`)
  booted in a fresh disposable profile on a non-3080 loopback port and the
  browser review reported `ok: true` with the evidence above.

## Cleanup

Stop the disposable server, then remove `"$temp"`, the profile copy, the review
patch, and any temporary screenshots. The live GUI on 3080 and the DSH checkout
are not modified by this review.
