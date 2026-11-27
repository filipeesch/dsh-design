/** Runnable compositions, relative to a scaffolded design folder. */
import { KIT_VERSION } from '@filipeesch/dsh-design-kit/meta'
import type { CatalogEntry } from './catalog.ts'

const sidebarExample = `<Screen id="home" title="Overview" layout="workspace">
  <Header id="overview-body" title="Overview" />
</Screen>`
const sidebarFiles = {
  'layouts/workspace.dsx': `<Layout>
  <Stack direction={{ mobile: "column", desktop: "row" }} gap="spacing.md" padding="spacing.md">
    <Stack id="sidebar" gap="spacing.sm" padding="spacing.md" background="color.surface">
      <Button id="go-overview" variant="ghost" onPress={navigate("home")}>Overview</Button>
      <Button id="go-reports" variant="ghost" onPress={navigate("reports")}>Reports</Button>
    </Stack>
    <ContentSlot />
  </Stack>
</Layout>`,
  'screens/reports.dsx': `<Screen id="reports" title="Reports" layout="workspace">
  <Header id="reports-body" title="Reports" />
</Screen>`,
}
const paletteExample = `<Screen id="home" title="Workspace" background="color.canvas">
  <Text color="color.text">Workspace</Text>
</Screen>`
const namedPaletteFiles = {
  'design.json': JSON.stringify({ kitVersion: KIT_VERSION, themes: { dark: 'themes/dark.json' } }, null, 2),
  'themes/dark.json': `{
  "colorScheme": "dark",
  "tokens": { "color": {
    "canvas": { "$type": "color", "$value": "#0f172a" },
    "text": { "$type": "color", "$value": "#f1f5f9" }
  } }
}`,
}

export const compositionReferences: readonly CatalogEntry[] = [
  {
    name: 'Layout',
    kind: 'construct',
    description: 'Root of layouts/<name>.dsx; screens opt in with a literal layout="name".',
    exampleContext: 'screen-file',
    example: sidebarExample,
    exampleFiles: sidebarFiles,
  },
  {
    name: 'ContentSlot',
    kind: 'construct',
    description: 'One empty marker per Layout, replaced by the consuming Screen children.',
    exampleContext: 'screen-file',
    example: sidebarExample,
    exampleFiles: sidebarFiles,
  },
  {
    name: 'styleClass',
    kind: 'construct',
    description: 'Opt a node root into declared local classes; merge stylesheets into the existing design.json.',
    exampleContext: 'screen-child',
    example: '<Card styleClass="notice"><Text>For internal review</Text></Card>',
    exampleFiles: {
      'design.json': JSON.stringify({ kitVersion: KIT_VERSION, stylesheets: ['styles/review.css'] }, null, 2),
      'styles/review.css': '.notice { padding: var(--dsx-spacing-lg); background-color: var(--dsx-color-canvas); }',
    },
  },
  {
    name: 'themes',
    kind: 'construct',
    description:
      'Merge a name-to-file themes map into design.json to overlay typed base tokens without duplicating screens.',
    exampleContext: 'screen-file',
    example: paletteExample,
    exampleFiles: namedPaletteFiles,
  },
  {
    name: 'shared-sidebar',
    kind: 'recipe',
    description: 'Share responsive sidebar navigation across screens while each screen supplies its own content.',
    exampleContext: 'screen-file',
    example: sidebarExample,
    exampleFiles: sidebarFiles,
  },
  {
    name: 'action-bar',
    kind: 'recipe',
    description: 'Stack a field above its action on mobile and let it fill the remaining row space on desktop.',
    exampleContext: 'screen-child',
    example: `<Stack id="action-bar" direction={{ mobile: "column", desktop: "row" }} align={{ mobile: "stretch", desktop: "end" }} gap="spacing.sm" padding="spacing.md">
  <Input id="repository" label="Repository" grow={{ desktop: true }} />
  <Button id="continue" onPress={navigate("details")}>Continue</Button>
</Stack>`,
    exampleFiles: {
      'screens/details.dsx': '<Screen id="details" title="Details"><Text>Ready to review.</Text></Screen>',
    },
  },
  {
    name: 'filter-drawer',
    kind: 'recipe',
    description: 'Open and dismiss an edge sheet from a button, or start with it open in a named review state.',
    exampleContext: 'screen-file',
    example: `<Screen id="home" title="Orders" states={{ "filters-open": { open: ["filters"], values: { status: "active" } } }}>
  <Button id="open-filters" onPress={open("filters")}>Filter orders</Button>
  <Drawer id="filters" title="Filters" side="right">
    <Stack gap="spacing.md">
      <Select id="status" label="Status" options={["active", "closed"]} />
      <Button id="apply-filters" onPress={close("filters")}>Done</Button>
    </Stack>
  </Drawer>
</Screen>`,
  },
  {
    name: 'fixture-table',
    kind: 'recipe',
    description: 'Bind a table to fictitious local JSON records with explicit field-to-column names.',
    exampleContext: 'screen-child',
    example: `<Table id="orders" columns={[{ label: "Order", field: "name" }, { label: "Status", field: "status" }]} rows={fixture("orders")} striped />`,
    exampleFiles: {
      'fixtures/orders.json': `[
  { "id": "order-a", "name": "Sample order A", "status": "Active" },
  { "id": "order-b", "name": "Sample order B", "status": "Closed" }
]`,
    },
  },
  {
    name: 'inline-feedback',
    kind: 'recipe',
    description: 'Keep an inline status visible next to a literal, wrapped log instead of opening an overlay.',
    exampleContext: 'screen-child',
    example: String.raw`<Stack gap="spacing.md">
  <Callout title="Check failed" tone="warning"><Text>Inspect the example log.</Text></Callout>
  <CodeBlock text={"Validation result:\n  Missing summary"} wrap />
</Stack>`,
  },
  {
    name: 'view-controls',
    kind: 'recipe',
    description:
      'Seed a pressed toggle, a segmented choice, and a visual switch without navigating to a different panel.',
    exampleContext: 'screen-file',
    example: `<Screen id="home" title="Preferences" states={{ focused: { values: { pin: true, mode: "list", alerts: true } } }}>
  <Stack gap="spacing.sm">
    <ToggleButton id="pin" label="Pin filters" />
    <SelectButton id="mode" label="View mode" options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }]} />
    <Switch id="alerts" label="Alerts" appearance="track" />
  </Stack>
</Screen>`,
  },
  {
    name: 'anchored-actions',
    kind: 'recipe',
    description:
      'Attach a popover to a stable trigger and give a split action separate primary and alternate outcomes.',
    exampleContext: 'screen-child',
    example: `<Stack gap="spacing.sm" padding="spacing.md" align="start">
  <Button id="show-help" onPress={open("help")}>Help</Button>
  <Popover id="help" title="Save options" anchor="show-help"><Text>Choose Save or Save draft.</Text></Popover>
  <SplitButton id="save" label="Save" onClick={open("saved")} options={[{ value: "draft", label: "Save draft", onClick: open("draft-saved") }]} />
  <Toast id="saved" message="Saved" />
  <Toast id="draft-saved" message="Draft saved" />
</Stack>`,
  },
]
