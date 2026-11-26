# Synthetic checkout example

A runnable, fictitious purchase flow with a catalog, checkout, and confirmation.
It uses named states, local fixtures, and real prototype navigation. No app
code, payments, or real customer records are involved.

Open a **Design** session in this folder or copy its `design/` folder into a
fresh workspace. Open the preview URL from `design_status`.

1. Click **Review order** in the catalog to enter checkout. **Price details**
   starts closed. Opening it shows the breakdown without navigating.
2. Under **Checkout** in the screen navigator, choose **Price breakdown open**
   (or open `/design/<session>/checkout?bp=mobile&state=prices-open`). Collapse
   **Price details**, then use **Place order** to reach **Confirmation**.
3. Choose **Review drawer open** to see the seeded drawer, email, and delivery
   plan together. Use **Keep editing** to dismiss the drawer.
4. In the map, the catalog, checkout, and confirmation are linked by real
   prototype actions. Toggling price details does not add a map edge.

For automated evidence, use `design_run_journey` with `catalog-to-confirmation`,
`checkout-price-details`, or `checkout-review`. Run
`design_lint({ screen: "catalog" })` to measure all configured breakpoints.
See the
[authoring guide](../../docs/authoring.md#set-up-chromium-for-measured-checks)
for browser setup.
