# Synthetic checkout example

A runnable, fictitious design project that exercises named states, fixtures, and
journeys. It is plain design data: no app code, credentials, or real customer
records.

## Run it

Copy the `design/` folder into a disposable workspace and open a **Design**
session from that workspace:

```sh
mkdir -p /tmp/dsh-design-example
cp -R examples/synthetic-checkout/design /tmp/dsh-design-example/design
```

Then use the design tools from that session:

1. `design_status` returns the local preview URL.
2. Open the preview at `<preview-url>/checkout?bp=mobile&state=review-open` to see
   the seeded drawer, email, and plan.
3. `design_run_journey({ journey: "catalog-to-confirmation" })` walks the catalog,
   checkout, and confirmation screens.
4. `design_run_journey({ journey: "checkout-review" })` verifies the named state
   and closes the drawer before continuing.
5. `design_lint({ screen: "catalog" })` measures every configured breakpoint.
   Pointer controls below 44 CSS pixels are reported as warnings; this example
   uses large buttons so the catalog is clean.
6. `design_screenshot({ screen: "checkout", breakpoint: "mobile" })` is unnecessary
   for this walkthrough; request it only when visual evidence is needed.

Chromium-backed checks need a Playwright Chromium matching `playwright-core`, or
an operator-configured executable:

```sh
pnpm exec playwright install chromium
# or
export DSH_DESIGN_CHROMIUM_PATH=/path/to/chrome
```

The example uses only fictional brands, names, and prices.
