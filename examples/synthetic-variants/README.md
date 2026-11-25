# Synthetic variants example

A runnable, entirely fictitious design project for comparing two branches of one
`Variants` group. It contains only synthetic products and prices.

## Run it

Copy `design/` into a disposable workspace and open a Design session:

```sh
mkdir -p /tmp/dsh-design-variants
cp -R examples/synthetic-variants/design /tmp/dsh-design-variants/design
```

Then:

1. `design_status` lists screen `catalog` with group `layout` (chosen `compact`).
2. Open `<preview-url>/catalog` for the chosen compact projection.
3. Open `<preview-url>/catalog?variant=layout:spacious` for the alternate.
4. Open `<preview-url>/catalog?compare=layout:compact:spacious&bp=mobile` to
   compare both branches side by side at 390 CSS pixels.
5. `design_view({ screen: "catalog", variant: "layout:spacious" })` projects the
   alternate, and `design_query` with the same selection finds its nodes.
6. `design_diff({ screen: "catalog", group: "layout", from: "compact", to:
"spacious" })` reports the stable `checkout` move into `footer` and its label
   change.

The example uses only fictional brands, names, and prices.
