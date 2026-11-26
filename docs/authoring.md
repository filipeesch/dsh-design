# Design authoring and preview

## Start a design

1. Start a **Design** session from the target workspace. Run `design_status` for the
   preview link, usable screen/state/variant/breakpoint selectors, and browser status.
   If there is no project, run `design_init` to scaffold `design/`.
2. Author `design/screens/*.dsx` with the normal file tools. Use stable kebab-case IDs
   for controls and targets, tokens for styling, and responsive props keyed by
   your project's breakpoints. DSX looks like JSX but is declarative: do not
   add imports, functions, services, or business rules. Keep fixture data fictitious.
3. Use `design_catalog({ names: ["Tabs", "ItemTemplate", "named-disclosure"] })` to look
   up components, DSX constructs and recipes in one call. A batch accepts 1–8
   names and preserves order. Use `{ name: "Disclosure" }` for one entry or
   `{}` for the index.
4. Fix diagnostics introduced by edits and use `design_validate` to see all
   diagnostics in the requested scope. Open the preview early to check a
   representative layout before reusing it. A valid source, a clean geometry
   check, and a good visual match are three different things.

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

- `design_view` is static without a breakpoint. With one, it measures the selected canvas.
- `design_lint` measures all configured breakpoints unless one is specified. It reports the effective selection even when there are no findings. Resolve missing, rejected, or undecodable media separately from geometry problems; use project-local passive raster images (PNG, JPEG, GIF, WebP).
- For inspection, lint, or capture, use `variant: "group:branch"` to ask for an explicit alternative. An unknown or incompatible selector is an error, not a fallback. Journeys use the chosen design and declare their initial selection in the source.
- Request a screenshot only when visual evidence is needed. It shows the selected canvas, not the map or review controls. The PNG is always saved under `design/.cache/screenshots/`; view the inline image when supported, otherwise inspect the PNG at the reported path. If Chromium is unavailable, use the interactive preview or static inspection and report that nothing was measured.

## Hand off selected evidence

```js
design_handoff({ screens: ['checkout'], states: ['prices-open'], breakpoints: ['mobile'] })
```

Share the returned manifest path with the implementing agent. The bundle has
chosen DSX, matching layouts and PNGs, tokens, and relevant journeys. Relevant
screen descriptions and labeled relationships are informational; a descriptive
or simulated edge does not add another render or another source file solely
because it names a destination. Handoff omits simulation controls, comments,
and other review UI. See [Design handoff](handoff.md) for selection and packaging.

## Runnable examples

| Example                                                       | What to try                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| [Bike library help center](../examples/synthetic-help-center) | Expand independent FAQs on one screen; the map has no navigation edges.                       |
| [Synthetic checkout](../examples/synthetic-checkout)          | Open the price-breakdown situation, collapse it in place, then place a fictitious order.      |
| [Document outcomes](../examples/document-outcomes)            | Submit a fictitious document and choose Approval or Correction request explicitly in preview. |

Open a **Design** session with an example folder as its working directory, or
copy its `design/` to a disposable workspace. Run all example source checks and
journeys from this plugin checkout:

```sh
pnpm run build
pnpm exec vitest run packages/host/tests/examples.spec.ts
```

Source validation runs without a browser. Journeys and measured checks run when
Chromium is available.
