# Design authoring and preview

## Start a design

1. Start a **Design** session from the target workspace. Run `design_status` for the
   preview link, running plugin build (separate from the kit pin/version), browser
   readiness, and usable screen/state/variant/breakpoint/theme/journey selections.
   If there is no project, run `design_init` to scaffold `design/`.
2. Author `design/screens/*.dsx` with the normal file tools. Use stable kebab-case IDs
   for controls and targets, tokens for styling, and responsive props keyed by
   your project's breakpoints. DSX looks like JSX but is declarative: do not
   add imports, functions, services, or business rules. Keep fixture data fictitious.
3. Use `design_catalog({ names: ["Tabs", "ItemTemplate", "named-disclosure"] })` to look
   up components, DSX constructs and recipes in one call. A batch accepts 1–8
   names and preserves order. Use `{ name: "Disclosure" }` for one entry or
   `{}` for the index. If you do not know the name, use intent search, such as
   `{ query: "shared sidebar" }` or `{ query: "tabela com dados fictícios" }`;
   search returns up to eight concise matches. Then look up a canonical match,
   such as `{ name: "shared-sidebar" }` or `{ name: "fixture-table" }`, to see
   its example and related references. Do not combine lookup modes.
4. Fix diagnostics introduced by edits and use `design_validate` to see all
   diagnostics: `{}` for the project, `{ file: "layouts/console-shell.dsx" }`
   for a design-relative file, or `{ screen: "overview" }` for a screen and
   its affected shared sources. Do not combine file and screen targets. Open the
   preview early to check a representative layout before reusing it. A valid
   source, a clean geometry check, and a good visual match are three different things.

## Share layout, palettes, and styles

Put repeated navigation and shell content in a named layout, such as
[`console-shell.dsx`](../examples/release-console/design/layouts/console-shell.dsx):

```jsx
<Layout>
  <Stack gap="spacing.md">
    <Header title="Release console" />
    <ContentSlot />
  </Stack>
</Layout>
```

Select it with a literal name on a screen, for example
`<Screen id="overview" layout="console-shell">…</Screen>`. Use exactly one
empty `<ContentSlot />`; the screen's children take its place. Each whole-screen
variant can select its own layout. Declare named states on the screen, not in
the layout. Layouts do not take arguments, nest other layouts, or declare
screens or variants. IDs remain unchanged, so a shared node and an inserted
screen node cannot have the same ID in one resolved screen.

In `design.json`, optionally declare palettes and stylesheets with paths relative
to `design/`:

```json
{
  "kitVersion": "1.0.0",
  "themes": { "dark": "themes/dark.json" },
  "stylesheets": ["styles/release.css"]
}
```

`tokens.json` remains the base palette. With no `defaultTheme` the preview uses
`base`, never the OS preference. A named theme can override existing tokens with
the same types; aliases resolve after merging. For example, if the base defines
`color.surface` as a color, `themes/dark.json` can contain:

```json
{
  "colorScheme": "dark",
  "tokens": { "color": { "surface": { "$type": "color", "$value": "#202d43" } } }
}
```

`colorScheme` is optional and sets native control defaults inside the canvas,
not the host UI. Select an authored palette using the **Theme** control or add
`theme=dark` to the preview link. A fresh visit restores the chosen palette and
authored state, not the previous viewer's interactions. Changing just the theme
in the live canvas keeps compatible controls as they are; navigation and
comparisons keep the selected theme.

Local CSS is opt-in. For example, add a rule to the declared
`styles/release.css` and put `styleClass="release-card"` on the desired node:

```css
.release-card {
  background-color: var(--dsx-color-surface);
}
```

Use one simple class selector per rule and literal, space-separated class names
in DSX. Rules apply only to the opted-in component root. Use supported
presentation and layout declarations, with references to declared token
variables if needed. Selector lists, descendant selectors, at-rules, imports,
URLs, custom property definitions, and `!important` are not allowed. Kit defaults
and props apply first, then matching class rules in stylesheet and rule order,
then the node's own `css`. Fix shared-source validation errors before using a
retained preview as a reference: it can still display the last valid rendition,
while checks require valid current sources.

## Pick the interaction that matches the design

Use `navigate("confirmation")` on a real prototype control when the canvas
should move to another screen. Use tabs to switch panels, a Drawer or Modal
for an overlay, and Disclosure for nearby information that opens in place.

```jsx
<Screen id="checkout" title="Checkout" states={{ 'prices-open': { disclosures: { 'price-details': true } } }}>
  <Disclosure id="price-details" label="Price details" defaultOpen={false}>
    <Text>Delivery: $4.00</Text>
  </Disclosure>
  <Button id="place-order" onPress={navigate('confirmation')}>
    Place order
  </Button>
</Screen>
```

This example assumes a screen with the ID `confirmation` exists. `defaultOpen`
sets the unnamed starting point (closed if omitted); set it to `{true}` to
start expanded. `disclosures` contains only booleans keyed by Disclosure IDs.
A named state seeds the authored starting view, not a recording of the viewer's
clicks. Each Disclosure owns its children and can be opened or closed independently.

For denser layouts, opt into `<Tabs id="sections" compact>` with nested `Tab`
children or `<IconButton id="close-panel" icon="close" label="Close" compact />`.
Compact styling does not change what the control does; give an icon-only action
an accessible name and use compact controls only where suitable for the target
pointer and keyboard experience.

For the newer controls, use the catalog or the [release console](../examples/release-console):

- `CodeBlock` takes a literal `text` string. Use a quoted expression with
  newline escapes (for example, `text={"Build output:\n  Ready"}`); optionally
  set `wrap` instead of scrolling inside the block. `Callout` provides titled,
  persistent inline feedback with a semantic tone.
- `ToggleButton` tracks a boolean pressed value. `SelectButton` tracks one
  declared option value and is not a tab list. Seed either in a named state's
  `values`. Use `Switch appearance="track"` for an opt-in visual switch.
- Anchor a `Popover` by stable ID, for example `anchor="release-options"`;
  without an anchor, it stays centered. A `SplitButton` has independent
  primary and menu actions. Opening its menu does not run the primary action.
- Use a dimension token for responsive `Drawer width`, `Disclosure expandedLabel`
  to name the expanded toggle, and `Input grow` to fill the space beside an action.

## Add optional review context

Keep durable context in `design/preview.json`, not in session review comments.
The file is optional and no migration is required. Its fields are all optional:

| Field           | Author shape                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `screens`       | IDs mapped to `{ summary, details? }`; both values are plain text.                                                                      |
| `groups`        | Ordered `{ id, label, screens }` entries; `screens` is an ordered array of screen IDs.                                                  |
| `situations`    | Ordered `{ id, label, parent, target: { screen, state? } }` entries.                                                                    |
| `relationships` | `{ id, label, kind, from, to }` entries. `kind` is `"illustrative"` or `"simulated"`; each endpoint is `{ screen }` or `{ situation }`. |

A situation appears under its `parent` screen and opens its target screen at
an optional named state. Use a named state for an alternate entry on the same
screen. An unqualified target is also valid as an unambiguous alternate entry
under a different screen. Two situations cannot target the same screen/state
pair. A situation is not a visual branch or a saved browser state. Keep
breakpoints and variants in their own selectors. IDs and references must be
local; don't include external URLs, scripts, personal data, or session feedback.
Invalid entries produce source diagnostics and are omitted without blocking
unrelated valid canvas content.

Here is an excerpt from the [document review example](../examples/document-outcomes/design/preview.json):

```json
{
  "screens": {
    "review": { "summary": "Compare the waiting state with approval and correction outcomes." }
  },
  "groups": [{ "id": "editorial", "label": "Editorial workflow", "screens": ["document", "review"] }],
  "situations": [
    { "id": "awaiting-review", "label": "Awaiting review", "parent": "document", "target": { "screen": "review" } },
    {
      "id": "document-approved",
      "label": "Document approved",
      "parent": "review",
      "target": { "screen": "review", "state": "approved" }
    }
  ],
  "relationships": [
    {
      "id": "simulate-approval",
      "label": "Approval",
      "kind": "simulated",
      "from": { "screen": "review" },
      "to": { "situation": "document-approved" }
    }
  ]
}
```

## Review the canvas and the map

Follow the URL from `design_status` while signed in or open **Design** beside
chat. The session opens on its entry or requested screen. The screen navigator
uses screen titles (falling back to IDs) and lists situations beneath their
parents. Open the navigator on demand in narrow or embedded previews. Changing
screens keeps the selected breakpoint; entry, active selection, and visual
variants are separate. The screen summary is outside the canvas; expand its
context for more detail when supplied.

Use the address bar or navigator links to share a starting point in the same
session, for example `/design/<session>/checkout?bp=mobile&state=prices-open`.
The link restores the seeded state on a fresh load; toggling the Disclosure
locally neither saves that change nor rewrites the link.

The map opens around the current screen and its immediate connections. Switch
to the full view for disconnected screens. **Prototype** links come from actual
`navigate()` controls in the resolved design, including controls whose panels
may be closed. Local tab, overlay, and Disclosure changes do not add edges.
**Illustrative** links document a relationship the prototype does not implement.
**Simulated** links describe fictitious results; choose a named outcome outside
the canvas to visit its destination. Browsing the map or opening a destination
from it only navigates; it never invokes the underlying prototype action or
simulates a result. There are no automatic transitions, timers, or real services.

## Reproduce a submitted review comment

Set the **Theme**, breakpoint, and starting state, then interact with the
canvas. Use **Comment** to select the node, save your draft, and use **Send** to
submit the reviewed batch. Drafts are not available to design tools. The sent
message identifies the screen, branch selection, breakpoint, and starting
state. It can also include a `Review context:` object with the effective theme
and stable IDs for open overlays, selected tabs, and expanded or collapsed
Disclosures. It does not capture typed values or secrets.

For example, in the [release console](../examples/release-console), open
`overview?bp=mobile&state=review-open&theme=dark`, close the draft drawer and
release notes, and select **Build log** before adding a comment. To compare that
context with its authored starting view, pass the submitted coordinates into
one explicit geometry case:

```js
design_view({
  mode: 'geometry',
  screen: 'overview',
  nodes: ['review-drawer', 'release-note', 'build-log'],
  cases: [
    { breakpoint: 'mobile', state: 'review-open', theme: 'dark' },
    {
      breakpoint: 'mobile',
      state: 'review-open',
      theme: 'dark',
      reviewContext: {
        screen: 'overview',
        selection: '',
        theme: 'dark',
        open: [],
        tabs: { 'release-tabs': 'logs' },
        disclosures: { 'release-details': false },
      },
    },
  ],
})
```

An empty `open` closes all overlays for that case; omitting `open` keeps the
normal seed. Explicit `false` closes one Disclosure. Supplied tab and
Disclosure entries override only those keys. Copy the branch coordinates from
the comment (`selection: ''` means there are no selected variant branches in
this example). If an ID, screen, or branch no longer matches, do not guess a
replacement. Ask for clarification when the comment cannot be located.
This measures a **current** rendition, not a historical replay; it never
changes the source or the owner's live preview.

## Set up Chromium for measured checks

The live preview and static tools don't need headless Chromium. `design_status`
reports whether a launch is unverified, or whether the last launch succeeded
or failed, without starting a browser. A configured executable is not proof it
will start. For an installed plugin, use the command reported for the effective
host/profile. Run it as the account that runs the DSH host, not in the target
app's dependency tree:

```sh
node "/path/to/installed/playwright-core/cli.js" install chromium
```

For this plugin's source checkout, use `pnpm exec playwright install chromium`.
If the host uses `PLAYWRIGHT_BROWSERS_PATH`, install with the same setting.
Alternatively set `DSH_DESIGN_CHROMIUM_PATH` in the host environment or set
`chromiumPath` on the profile's `design-host` configuration, then restart the
host. Use a Chromium executable that can run with its sandbox enabled. The
plugin does not install browsers or launch them without a sandbox.

From the checkout fixture's Design session, for example:

```js
design_validate({})
design_view({ screen: 'checkout', state: 'prices-open', breakpoint: 'mobile' })
design_lint({ screen: 'checkout', state: 'prices-open' })
design_run_journey({ journey: 'checkout-price-details' })
design_screenshot({ screen: 'checkout', state: 'prices-open', breakpoint: 'mobile', highlight: 'price-details' })
```

- `design_view` is static without a breakpoint. With one, it measures the selected canvas; `node` and `depth` focus both the tree and measurement. `open` is for the text projection, not a render seed.
- Use `mode: 'geometry'` for exact-ID measurements: pass 1–24 distinct `nodes` and 1–6 ordered `cases`. Each case needs a `breakpoint` and can select a `state`, `theme`, and `reviewContext`. Use one `screen` and optional `variant` for the whole call. Don't combine this mode with legacy single-view arguments. The result distinguishes visible boxes, hidden nodes, and absent IDs; it contains no tree or PNG.
- Use `design_query` for structural searches, not geometry: for example `{ screen: 'overview', component: 'Input' }`. It does not take state, theme, or breakpoint.
- `design_lint` measures all configured breakpoints unless one is specified. It reports the effective selection even when there are no findings. Resolve missing, rejected, or undecodable media separately from geometry problems; use project-local passive raster images (PNG, JPEG, GIF, WebP).
- For inspection, lint, or capture, use `variant: "group:branch"` to ask for an explicit alternative. Pass `theme: "dark"` (or another declared name) when measuring or capturing a palette other than the project default. An unknown or incompatible selector is an error, not a fallback. Journeys use the chosen design and declare their initial selection, including an optional `theme`, on `<Journey>`.
- Request a screenshot only when visual evidence is needed. It shows the selected canvas, not the map or review controls. The PNG is always saved under `design/.cache/screenshots/`; view the inline image when supported, otherwise inspect the PNG at the reported path. If Chromium is unavailable, use the interactive preview or static inspection and report that nothing was measured.

## Share accepted design files

For example, point the implementing agent to `design/screens/checkout.dsx`,
`design/tokens.json`, and `design/journeys/checkout-price-details.dsx`. Include
the accepted screen and the named state, breakpoint, theme, and variant as
applicable. Give the Git revision for an agreed version and report which checks
passed. Only share a local screenshot path if the recipient can read that workspace.
No export is needed.

## Runnable examples

| Example                                                       | What to try                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [Bike library help center](../examples/synthetic-help-center) | Expand independent FAQs on one screen; the map has no navigation edges.                       |
| [Synthetic checkout](../examples/synthetic-checkout)          | Open the price-breakdown situation, collapse it in place, then place a fictitious order.      |
| [Document outcomes](../examples/document-outcomes)            | Submit a fictitious document and choose Approval or Correction request explicitly in preview. |
| [Release console](../examples/release-console)                | Switch palettes, open an anchored menu, and reproduce safe submitted review coordinates.      |

Open a **Design** session with an example folder as its working directory, or
copy its `design/` to a disposable workspace. Run all example source checks and
journeys from this plugin checkout:

```sh
pnpm run build
pnpm exec vitest run packages/host/tests/examples.spec.ts
```

Source validation runs without a browser. Journeys and measured checks run when
Chromium is available.
