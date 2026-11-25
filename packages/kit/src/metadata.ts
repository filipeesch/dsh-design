/**
 * Single source of truth for the component kit: every component's props,
 * enumerations, token types, required id, children rule, catalog text, and a
 * minimal example. The validator, the catalog tool, the prompt section, and the
 * renderer all read this table.
 */
import type { ComponentMeta, KitMetadata, PropMeta } from '@filipeesch/dsh-design-core'

/** Installed kit version; the project pin is checked against it. */
export const KIT_VERSION = '1.0.0'

const padding: PropMeta = {
  name: 'padding',
  kind: 'token',
  tokenType: 'dimension',
  description: 'Inner spacing token.',
}
const gap: PropMeta = { name: 'gap', kind: 'token', tokenType: 'dimension', description: 'Space between children.' }
const margin: PropMeta = { name: 'margin', kind: 'token', tokenType: 'dimension', description: 'Outer spacing token.' }
const background: PropMeta = {
  name: 'background',
  kind: 'token',
  tokenType: 'color',
  description: 'Background color token.',
}
const color: PropMeta = { name: 'color', kind: 'token', tokenType: 'color', description: 'Text color token.' }
const borderColor: PropMeta = {
  name: 'borderColor',
  kind: 'token',
  tokenType: 'color',
  description: 'Border color token.',
}
const radius: PropMeta = { name: 'radius', kind: 'token', tokenType: 'dimension', description: 'Corner radius token.' }
const shadow: PropMeta = { name: 'shadow', kind: 'token', tokenType: 'shadow', description: 'Elevation shadow token.' }
const width: PropMeta = { name: 'width', kind: 'token', tokenType: 'dimension', description: 'Width token or literal.' }
const height: PropMeta = {
  name: 'height',
  kind: 'token',
  tokenType: 'dimension',
  description: 'Height token or literal.',
}
const fontSize: PropMeta = { name: 'fontSize', kind: 'token', tokenType: 'dimension', description: 'Font size token.' }
const fontWeight: PropMeta = {
  name: 'fontWeight',
  kind: 'token',
  tokenType: 'fontWeight',
  description: 'Font weight token.',
}
const fontFamily: PropMeta = {
  name: 'fontFamily',
  kind: 'token',
  tokenType: 'fontFamily',
  description: 'Font family token.',
}

/** Components that accept the standard surface styling props. */
const surfaceProps: PropMeta[] = [padding, background, radius, shadow, borderColor]

/** One component entry. */
function component(
  name: string,
  description: string,
  category: ComponentMeta['category'],
  tier: ComponentMeta['tier'],
  options: {
    requiredId?: boolean
    interactive?: boolean
    overlay?: boolean
    role?: string
    children?: ComponentMeta['children']
    props?: PropMeta[]
    example: string
  },
): ComponentMeta {
  return {
    name,
    description,
    category,
    tier,
    requiredId: options.requiredId ?? false,
    interactive: options.interactive ?? false,
    overlay: options.overlay ?? false,
    ...(options.role === undefined ? {} : { role: options.role }),
    children: options.children ?? 'none',
    props: options.props ?? [],
    example: options.example,
  }
}

const DIRECTION_VALUES = ['row', 'column'] as const
const ALIGN_VALUES = ['start', 'center', 'end', 'stretch'] as const
const JUSTIFY_VALUES = ['start', 'center', 'end', 'between', 'around'] as const

const definitions: ComponentMeta[] = [
  component('Screen', 'Root of one design screen; owns the page title and background.', 'layout', 1, {
    requiredId: true,
    children: 'elements',
    role: 'main',
    props: [
      { name: 'title', kind: 'string', description: 'Screen title used by the preview and the page title.' },
      background,
      { name: 'maxWidth', kind: 'token', tokenType: 'dimension', description: 'Maximum content width token.' },
    ],
    example: '<Screen id="home" title="Home">\n  <Text>Hello</Text>\n</Screen>',
  }),
  component('Stack', 'Vertical or horizontal flow layout with token spacing.', 'layout', 1, {
    children: 'elements',
    props: [
      { name: 'direction', kind: 'enum', values: [...DIRECTION_VALUES], default: 'column', description: 'Main axis.' },
      gap,
      padding,
      margin,
      background,
      radius,
      {
        name: 'align',
        kind: 'enum',
        values: [...ALIGN_VALUES],
        default: 'stretch',
        description: 'Cross-axis alignment.',
      },
      {
        name: 'justify',
        kind: 'enum',
        values: [...JUSTIFY_VALUES],
        default: 'start',
        description: 'Main-axis distribution.',
      },
      { name: 'wrap', kind: 'boolean', description: 'Allow children to wrap.' },
    ],
    example: '<Stack gap="spacing.md" padding="spacing.lg">\n  <Text>One</Text>\n  <Text>Two</Text>\n</Stack>',
  }),
  component('Grid', 'Responsive column grid using token spacing.', 'layout', 1, {
    children: 'elements',
    props: [
      { name: 'columns', kind: 'number', default: 2, description: 'Column count.' },
      gap,
      padding,
      background,
      radius,
    ],
    example:
      '<Grid columns={2} gap="spacing.md">\n  <Box padding="spacing.md" />\n  <Box padding="spacing.md" />\n</Grid>',
  }),
  component('Box', 'Generic container with surface styling.', 'layout', 1, {
    children: 'any',
    props: [padding, margin, background, radius, shadow, width, height, borderColor],
    example: '<Box padding="spacing.md" background="color.surface" radius="radius.md">\n  <Text>Boxed</Text>\n</Box>',
  }),
  component('Spacer', 'Fixed-size empty space.', 'layout', 1, {
    props: [{ name: 'size', kind: 'token', tokenType: 'dimension', required: true, description: 'Space size token.' }],
    example: '<Spacer size="spacing.lg" />',
  }),
  component('Divider', 'Thin separator between content groups.', 'layout', 1, {
    props: [
      {
        name: 'orientation',
        kind: 'enum',
        values: ['horizontal', 'vertical'],
        default: 'horizontal',
        description: 'Divider direction.',
      },
      margin,
    ],
    example: '<Divider />',
  }),
  component('Header', 'Page header with title, subtitle, and optional actions.', 'navigation', 1, {
    children: 'any',
    props: [
      { name: 'title', kind: 'string', required: true, description: 'Header title.' },
      { name: 'subtitle', kind: 'string', description: 'Supporting line.' },
      background,
      padding,
    ],
    example: '<Header title="Orders" subtitle="This week" />',
  }),
  component('Text', 'Text paragraph with token typography.', 'content', 1, {
    children: 'text',
    props: [
      {
        name: 'variant',
        kind: 'enum',
        values: ['body', 'heading', 'title', 'caption', 'label'],
        default: 'body',
        description: 'Typography preset.',
      },
      color,
      fontSize,
      fontWeight,
      fontFamily,
      { name: 'align', kind: 'enum', values: ['left', 'center', 'right'], description: 'Text alignment.' },
    ],
    example: '<Text variant="heading">Hello</Text>',
  }),
  component('Icon', 'Bundled inline icon.', 'content', 1, {
    props: [
      {
        name: 'name',
        kind: 'enum',
        required: true,
        values: [
          'check',
          'close',
          'plus',
          'search',
          'chevron-down',
          'chevron-right',
          'menu',
          'user',
          'arrow-right',
          'alert',
          'info',
          'settings',
        ],
        description: 'Bundled icon name.',
      },
      { name: 'size', kind: 'token', tokenType: 'dimension', description: 'Icon edge size token.' },
      color,
    ],
    example: '<Icon name="check" />',
  }),
  component('Image', 'Local image or placeholder from the design folder.', 'content', 1, {
    props: [
      {
        name: 'src',
        kind: 'image',
        required: true,
        description: 'Path inside the design folder, or "placeholder: description".',
      },
      { name: 'alt', kind: 'string', description: 'Alternative text.' },
      width,
      height,
      radius,
      { name: 'fit', kind: 'enum', values: ['cover', 'contain', 'fill'], default: 'cover', description: 'Object fit.' },
    ],
    example: '<Image src="placeholder: product photo" alt="Product" height="120px" radius="radius.md" />',
  }),
  component('Button', 'Button with variants, sizes, and an optional press interaction.', 'form', 1, {
    requiredId: true,
    interactive: true,
    children: 'any',
    role: 'button',
    props: [
      {
        name: 'variant',
        kind: 'enum',
        values: ['primary', 'secondary', 'ghost', 'danger', 'link'],
        default: 'primary',
        description: 'Visual variant.',
      },
      { name: 'size', kind: 'enum', values: ['sm', 'md', 'lg'], default: 'md', description: 'Control size.' },
      { name: 'disabled', kind: 'boolean', description: 'Disable the button.' },
      { name: 'fullWidth', kind: 'boolean', description: 'Stretch to the container width.' },
      { name: 'onPress', kind: 'event', description: 'Interaction reference: open, close, toggle, or navigate.' },
    ],
    example: '<Button id="save" variant="primary" onPress={navigate("details")}>Save</Button>',
  }),
  component('IconButton', 'Square icon-only button with an accessible label.', 'form', 1, {
    requiredId: true,
    interactive: true,
    role: 'button',
    props: [
      {
        name: 'icon',
        kind: 'enum',
        required: true,
        values: [
          'check',
          'close',
          'plus',
          'search',
          'chevron-down',
          'chevron-right',
          'menu',
          'user',
          'arrow-right',
          'alert',
          'info',
          'settings',
        ],
        description: 'Bundled icon name.',
      },
      { name: 'label', kind: 'string', required: true, description: 'Accessible name.' },
      {
        name: 'variant',
        kind: 'enum',
        values: ['ghost', 'secondary', 'primary'],
        default: 'ghost',
        description: 'Visual variant.',
      },
      { name: 'disabled', kind: 'boolean', description: 'Disable the button.' },
      { name: 'onPress', kind: 'event', description: 'Interaction reference.' },
    ],
    example: '<IconButton id="close-panel" icon="close" label="Close" />',
  }),
  component('Input', 'Single-line text input with a label.', 'form', 1, {
    requiredId: true,
    interactive: true,
    props: [
      { name: 'label', kind: 'string', description: 'Field label.' },
      { name: 'placeholder', kind: 'string', description: 'Placeholder text.' },
      { name: 'value', kind: 'string', description: 'Initial value.' },
      {
        name: 'type',
        kind: 'enum',
        values: ['text', 'email', 'password', 'number', 'search'],
        default: 'text',
        description: 'Native input type.',
      },
      { name: 'disabled', kind: 'boolean', description: 'Disable the input.' },
      { name: 'onChange', kind: 'event', description: 'Interaction reference fired on change.' },
    ],
    example: '<Input id="email" label="Email" placeholder="you@example.com" />',
  }),
  component('TextArea', 'Multi-line text input.', 'form', 1, {
    requiredId: true,
    interactive: true,
    props: [
      { name: 'label', kind: 'string', description: 'Field label.' },
      { name: 'placeholder', kind: 'string', description: 'Placeholder text.' },
      { name: 'value', kind: 'string', description: 'Initial value.' },
      { name: 'rows', kind: 'number', default: 3, description: 'Visible rows.' },
      { name: 'disabled', kind: 'boolean', description: 'Disable the control.' },
      { name: 'onChange', kind: 'event', description: 'Interaction reference fired on change.' },
    ],
    example: '<TextArea id="notes" label="Notes" placeholder="Add a note" />',
  }),
  component('Select', 'Single-choice select control.', 'form', 1, {
    requiredId: true,
    interactive: true,
    props: [
      { name: 'label', kind: 'string', description: 'Field label.' },
      { name: 'options', kind: 'array', required: true, description: 'Option labels or { label, value } objects.' },
      { name: 'value', kind: 'string', description: 'Initial selected value.' },
      { name: 'placeholder', kind: 'string', description: 'Empty option label.' },
      { name: 'disabled', kind: 'boolean', description: 'Disable the control.' },
      { name: 'onChange', kind: 'event', description: 'Interaction reference fired on change.' },
    ],
    example: '<Select id="status" label="Status" options={["Open", "Closed"]} />',
  }),
  component('Checkbox', 'Checkbox with a label.', 'form', 1, {
    requiredId: true,
    interactive: true,
    props: [
      { name: 'label', kind: 'string', description: 'Checkbox label.' },
      { name: 'checked', kind: 'boolean', description: 'Initial checked state.' },
      { name: 'disabled', kind: 'boolean', description: 'Disable the checkbox.' },
      { name: 'onChange', kind: 'event', description: 'Interaction reference fired on change.' },
    ],
    example: '<Checkbox id="terms" label="Accept terms" />',
  }),
  component('Radio', 'Radio option in a named group.', 'form', 1, {
    requiredId: true,
    interactive: true,
    props: [
      { name: 'label', kind: 'string', description: 'Radio label.' },
      { name: 'name', kind: 'string', required: true, description: 'Radio group name.' },
      { name: 'value', kind: 'string', description: 'Value this radio contributes.' },
      { name: 'checked', kind: 'boolean', description: 'Initial checked state.' },
      { name: 'disabled', kind: 'boolean', description: 'Disable the radio.' },
      { name: 'onChange', kind: 'event', description: 'Interaction reference fired on change.' },
    ],
    example: '<Radio id="plan-basic" name="plan" label="Basic" value="basic" />',
  }),
  component('Switch', 'On/off switch with a label.', 'form', 1, {
    requiredId: true,
    interactive: true,
    role: 'switch',
    props: [
      { name: 'label', kind: 'string', description: 'Switch label.' },
      { name: 'checked', kind: 'boolean', description: 'Initial state.' },
      { name: 'disabled', kind: 'boolean', description: 'Disable the switch.' },
      { name: 'onChange', kind: 'event', description: 'Interaction reference fired on change.' },
    ],
    example: '<Switch id="notifications" label="Notifications" />',
  }),
  component('Tabs', 'Tab list that switches its panels.', 'navigation', 1, {
    requiredId: true,
    interactive: true,
    children: 'elements',
    role: 'tablist',
    props: [
      { name: 'value', kind: 'string', description: 'Initially active tab value.' },
      { name: 'onChange', kind: 'event', description: 'Interaction reference fired on change.' },
    ],
    example:
      '<Tabs id="sections" value="overview">\n  <Tab id="tab-overview" label="Overview" value="overview">\n    <Text>Overview panel</Text>\n  </Tab>\n</Tabs>',
  }),
  component('Tab', 'One tab and its panel.', 'navigation', 1, {
    requiredId: true,
    interactive: true,
    children: 'any',
    role: 'tabpanel',
    props: [
      { name: 'label', kind: 'string', required: true, description: 'Tab label.' },
      { name: 'value', kind: 'string', description: 'Stable tab value.' },
    ],
    example: '<Tab id="tab-overview" label="Overview" value="overview">\n  <Text>Panel</Text>\n</Tab>',
  }),
  component('Card', 'Surface container for grouped content.', 'layout', 1, {
    children: 'any',
    props: [
      ...surfaceProps,
      {
        name: 'variant',
        kind: 'enum',
        values: ['elevated', 'outlined', 'flat'],
        default: 'elevated',
        description: 'Surface variant.',
      },
      { name: 'onPress', kind: 'event', description: 'Interaction reference for a pressable card.' },
    ],
    example: '<Card padding="spacing.md">\n  <Text>Card content</Text>\n</Card>',
  }),
  component('List', 'Vertical list of list items.', 'data', 1, {
    children: 'elements',
    role: 'list',
    props: [gap, padding, background, radius],
    example: '<List gap="spacing.sm">\n  <ListItem>One</ListItem>\n</List>',
  }),
  component('ListItem', 'One row in a list.', 'data', 1, {
    children: 'any',
    role: 'listitem',
    props: [
      padding,
      background,
      { name: 'onPress', kind: 'event', description: 'Interaction reference for a pressable row.' },
      {
        name: 'bare',
        kind: 'boolean',
        default: false,
        description: 'Remove the default row surface; used by fixture-backed list wrappers.',
      },
    ],
    example: '<ListItem>Row</ListItem>',
  }),
  component('Drawer', 'Side sheet opened by open("id") and dismissed by close, backdrop, or Escape.', 'overlay', 1, {
    requiredId: true,
    interactive: true,
    overlay: true,
    children: 'any',
    role: 'dialog',
    props: [
      { name: 'title', kind: 'string', description: 'Drawer heading.' },
      {
        name: 'side',
        kind: 'enum',
        values: ['left', 'right'],
        default: 'right',
        description: 'Edge the drawer attaches to.',
      },
      width,
      padding,
      background,
      { name: 'onClose', kind: 'event', description: 'Interaction reference fired when dismissed.' },
    ],
    example: '<Drawer id="filters" title="Filters">\n  <Text>Filter content</Text>\n</Drawer>',
  }),
  component('Modal', 'Centered dialog opened by open("id").', 'overlay', 1, {
    requiredId: true,
    interactive: true,
    overlay: true,
    children: 'any',
    role: 'dialog',
    props: [
      { name: 'title', kind: 'string', description: 'Modal heading.' },
      { name: 'size', kind: 'enum', values: ['sm', 'md', 'lg'], default: 'md', description: 'Dialog width preset.' },
      padding,
      background,
      { name: 'onClose', kind: 'event', description: 'Interaction reference fired when dismissed.' },
    ],
    example: '<Modal id="confirm" title="Confirm">\n  <Text>Are you sure?</Text>\n</Modal>',
  }),
]

const tierTwo: ComponentMeta[] = [
  component('Avatar', 'User avatar from a local image or initials.', 'content', 2, {
    props: [
      { name: 'src', kind: 'image', description: 'Path inside the design folder, or "placeholder: description".' },
      { name: 'initials', kind: 'string', description: 'Initials shown when no image is available.' },
      { name: 'size', kind: 'token', tokenType: 'dimension', description: 'Avatar edge size token.' },
    ],
    example: '<Avatar initials="AE" />',
  }),
  component('Badge', 'Small status label.', 'content', 2, {
    children: 'text',
    props: [
      {
        name: 'tone',
        kind: 'enum',
        values: ['neutral', 'success', 'warning', 'danger', 'info'],
        default: 'neutral',
        description: 'Badge tone.',
      },
    ],
    example: '<Badge tone="success">Active</Badge>',
  }),
  component('MultiSelect', 'Select control that keeps several values.', 'form', 2, {
    requiredId: true,
    interactive: true,
    props: [
      { name: 'label', kind: 'string', description: 'Field label.' },
      { name: 'options', kind: 'array', required: true, description: 'Option labels or { label, value } objects.' },
      { name: 'values', kind: 'array', description: 'Initially selected values.' },
      { name: 'disabled', kind: 'boolean', description: 'Disable the control.' },
      { name: 'onChange', kind: 'event', description: 'Interaction reference fired on change.' },
    ],
    example: '<MultiSelect id="tags" label="Tags" options={["A", "B"]} />',
  }),
  component('Combobox', 'Text input with filtered suggestions.', 'form', 2, {
    requiredId: true,
    interactive: true,
    props: [
      { name: 'label', kind: 'string', description: 'Field label.' },
      { name: 'options', kind: 'array', required: true, description: 'Suggestion labels or { label, value } objects.' },
      { name: 'value', kind: 'string', description: 'Initial value.' },
      { name: 'placeholder', kind: 'string', description: 'Placeholder text.' },
      { name: 'disabled', kind: 'boolean', description: 'Disable the control.' },
      { name: 'onChange', kind: 'event', description: 'Interaction reference fired on change.' },
    ],
    example: '<Combobox id="city" label="City" options={["Lisbon", "Porto"]} />',
  }),
  component('Table', 'Data table driven by column and row arrays.', 'data', 2, {
    props: [
      { name: 'columns', kind: 'array', required: true, description: 'Column headers.' },
      { name: 'rows', kind: 'array', required: true, description: 'Rows of cell strings.' },
      { name: 'striped', kind: 'boolean', description: 'Zebra-stripe rows.' },
      padding,
      background,
      radius,
    ],
    example: '<Table columns={["Name", "Status"]} rows={[["Ada", "Active"], ["Linus", "Away"]]} />',
  }),
  component('Popover', 'Anchored panel opened by open("id").', 'overlay', 2, {
    requiredId: true,
    interactive: true,
    overlay: true,
    children: 'any',
    role: 'dialog',
    props: [
      { name: 'title', kind: 'string', description: 'Popover heading.' },
      padding,
      background,
      { name: 'onClose', kind: 'event', description: 'Interaction reference fired when dismissed.' },
    ],
    example: '<Popover id="menu-popover" title="Options">\n  <Text>One</Text>\n</Popover>',
  }),
  component('Tooltip', 'Short hint attached to a child.', 'overlay', 2, {
    children: 'any',
    props: [{ name: 'text', kind: 'string', required: true, description: 'Tooltip text.' }],
    example: '<Tooltip text="Saves the form">\n  <Button id="tip-target">Save</Button>\n</Tooltip>',
  }),
  component('Toast', 'Transient message opened by open("id").', 'overlay', 2, {
    requiredId: true,
    interactive: true,
    overlay: true,
    children: 'any',
    role: 'status',
    props: [
      { name: 'message', kind: 'string', description: 'Toast message.' },
      {
        name: 'tone',
        kind: 'enum',
        values: ['info', 'success', 'warning', 'danger'],
        default: 'info',
        description: 'Toast tone.',
      },
      { name: 'onClose', kind: 'event', description: 'Interaction reference fired when dismissed.' },
    ],
    example: '<Toast id="saved-toast" message="Saved" tone="success" />',
  }),
  component('Menu', 'Menu panel opened by open("id").', 'overlay', 2, {
    requiredId: true,
    interactive: true,
    overlay: true,
    children: 'any',
    role: 'menu',
    props: [
      { name: 'title', kind: 'string', description: 'Menu heading.' },
      padding,
      background,
      { name: 'onClose', kind: 'event', description: 'Interaction reference fired when dismissed.' },
    ],
    example: '<Menu id="actions-menu" title="Actions">\n  <ListItem>Edit</ListItem>\n</Menu>',
  }),
  component('Breadcrumbs', 'Hierarchy trail rendered from a string list.', 'navigation', 2, {
    props: [
      {
        name: 'items',
        kind: 'array',
        required: true,
        description: 'Breadcrumb labels, last one being the current page.',
      },
    ],
    example: '<Breadcrumbs items={["Home", "Orders", "Order 42"]} />',
  }),
  component('Pagination', 'Page selector rendered from a current page and total.', 'navigation', 2, {
    requiredId: true,
    interactive: true,
    role: 'navigation',
    props: [
      { name: 'page', kind: 'number', default: 1, description: 'Current page, one-based.' },
      { name: 'total', kind: 'number', required: true, description: 'Total number of pages.' },
      { name: 'onChange', kind: 'event', description: 'Interaction reference fired on change.' },
    ],
    example: '<Pagination id="pages" page={1} total={5} />',
  }),
  component('Progress', 'Determinate or indeterminate progress bar.', 'feedback', 2, {
    role: 'progressbar',
    props: [
      { name: 'value', kind: 'number', description: 'Current value; omit for indeterminate.' },
      { name: 'max', kind: 'number', default: 100, description: 'Maximum value.' },
      { name: 'label', kind: 'string', description: 'Accessible label.' },
      {
        name: 'tone',
        kind: 'enum',
        values: ['action', 'success', 'warning', 'danger'],
        default: 'action',
        description: 'Bar color.',
      },
    ],
    example: '<Progress value={40} max={100} label="Upload" />',
  }),
  component('Skeleton', 'Loading placeholder with no animation in deterministic mode.', 'feedback', 2, {
    props: [
      width,
      height,
      {
        name: 'variant',
        kind: 'enum',
        values: ['text', 'rect', 'circle'],
        default: 'text',
        description: 'Placeholder shape.',
      },
      radius,
      background,
    ],
    example: '<Skeleton width="200px" height="16px" />',
  }),
  component('EmptyState', 'Empty-result message with an optional action.', 'feedback', 2, {
    children: 'any',
    props: [
      { name: 'title', kind: 'string', required: true, description: 'Empty-state title.' },
      { name: 'message', kind: 'string', description: 'Supporting message.' },
      padding,
    ],
    example:
      '<EmptyState title="No orders" message="New orders will appear here.">\n  <Button id="refresh">Refresh</Button>\n</EmptyState>',
  }),
]

/** Every kit component keyed by name. */
export const kitMetadata: KitMetadata = Object.fromEntries(
  [...definitions, ...tierTwo].map((meta) => [meta.name, meta]),
)

/** Component names in catalog order. */
export const componentNames: readonly string[] = Object.keys(kitMetadata)
