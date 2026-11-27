# Synthetic release console

Open a **Design** session with this directory as the workspace, or copy its
`design/` into a scratch workspace. All names, release data, and actions are
fictitious: nothing is published. Start with `design_status({})`.

## Try it

- Switch between **Overview** and **History**: both use [one layout](design/layouts/console-shell.dsx)
  and [opt-in class styling](design/styles/release.css). Switch between **light**
  and **dark** with the Theme control, including after opening an overlay.
- Select a release channel, pin the release, and toggle **Notify demo team**.
  Try the **Build log** tab on mobile: the code scrolls within its own block.
- **Release options** opens a Popover anchored to its trigger. The split action's
  primary opens History; **More publish actions → Review draft** opens the Drawer
  without changing screens. On desktop the repository field grows next to Review.
- Open the **Draft review open** situation in dark at mobile. Close the Drawer,
  collapse the release notes, select **Build log**, and submit a comment on the log.
  Follow the [review context example](../../docs/authoring.md#reproduce-a-submitted-review-comment)
  to measure the authored starting point and the submitted coordinates separately.

For a Chromium-enabled session:

```js
design_validate({})
design_run_journey({ journey: 'review-release' })
design_screenshot({ screen: 'overview', breakpoint: 'desktop', theme: 'light' })
design_screenshot({ screen: 'overview', breakpoint: 'mobile', theme: 'dark' })
design_screenshot({ screen: 'overview', breakpoint: 'mobile', theme: 'dark', state: 'menu-open' })
```

## Example of path-only delivery

> Accepted: Overview, `menu-open`, mobile (390 CSS px), dark, no variant.
> In the agreed Git revision, see `design/screens/overview.dsx`,
> `design/layouts/console-shell.dsx`, `design/design.json`, `design/tokens.json`,
> `design/themes/dark.json`, and `design/styles/release.css`.
> Interaction check: `design/journeys/review-release.dsx`. Include the actual
> validation and journey results, and the returned screenshot path if the
> recipient can read the workspace.

These paths already exist in the project; don't recreate them as an export.
The DSH preview URL belongs to its session. A path in `design/.cache/screenshots/`
is local evidence, not a shareable download for another workspace.
