# design-kit Specification

## Purpose

Defines the component kit that renders designs: which standard web components exist, how tokens theme them, how they behave when clicked, and how rendering stays deterministic and machine-readable.

## Requirements

### Requirement: Base component set
The kit SHALL provide at least: `Screen`, `Stack`, `Grid`, `Box`, `Spacer`, `Divider`, `Header`, `Text`, `Icon`, `Image`, `Avatar`, `Badge`, `Button` (variants `primary`, `secondary`, `ghost`, `danger`, `link`; sizes; icon-only), `IconButton`, `Input`, `TextArea`, `Select`, `MultiSelect`, `Combobox`, `Checkbox`, `Radio`, `Switch`, `Tabs` and `Tab`, `Card`, `List` and `ListItem`, `Table`, `Drawer`, `Modal`, `Popover`, `Tooltip`, `Toast`, `Menu`, `Breadcrumbs`, `Pagination`, `Progress`, `Skeleton`, and `EmptyState`.

#### Scenario: Catalog completeness
- **WHEN** the catalog lists components
- **THEN** every component above appears with its props, variants, defaults, and an example

### Requirement: Token theming
Every visual property of kit components SHALL derive from the project's tokens or from explicit props. Changing a token SHALL change every component that uses it on the next render.

#### Scenario: Token change propagates
- **WHEN** `color.action` changes in `tokens.json`
- **THEN** all primary buttons in the open preview show the new color after the live reload

### Requirement: Built-in interactions
Components SHALL behave like their web counterparts without extra DSL: tabs switch on click, selects open and keep the chosen value, checkboxes, radios, and switches toggle, inputs accept typing, overlays open and close through interaction references and dismiss through their close control, a backdrop click, or the Escape key, and `navigate` shows the target screen.

#### Scenario: Open a drawer
- **WHEN** the user clicks a button with `onPress={open("filters")}`
- **THEN** the drawer `filters` slides in, and pressing Escape closes it

#### Scenario: Navigate
- **WHEN** the user clicks an element with `onPress={navigate("details")}`
- **THEN** the preview shows the `details` screen

### Requirement: Breakpoint rendering
The kit SHALL render any screen at any configured breakpoint width, applying responsive values for that width.

#### Scenario: Switch breakpoint
- **WHEN** the preview switches from `desktop` to `mobile`
- **THEN** the frame width becomes the mobile width and responsive props switch to their mobile values

### Requirement: Semantic, addressable markup
Rendered elements SHALL use semantic HTML roles (`button`, `dialog`, `tablist`, `tab`, `listbox`, `navigation`, and so on) and SHALL carry their component type and DSL node ID (or structural address) as attributes.

#### Scenario: Map DOM back to DSL
- **WHEN** any rendered element is inspected
- **THEN** its component type and node ID can be read from its attributes without knowing the kit's internal markup

### Requirement: Deterministic rendering mode
The kit SHALL offer a deterministic mode in which animations and transitions are disabled, only fonts bundled with the kit are used, no network request is made, and date and time are fixed. In this mode the same project content and interaction state MUST produce identical markup and layout.

#### Scenario: Repeated render
- **WHEN** the same screen and state render twice in deterministic mode
- **THEN** the markup and every element's computed box are identical

### Requirement: Kit version compatibility
The kit SHALL have a semantic version. When the project's pinned kit version is not compatible with the installed kit, rendering MUST stop with an error naming both versions.

#### Scenario: Incompatible pin
- **WHEN** the project pins kit `2.x` and the installed kit is `1.4.0`
- **THEN** validation and the preview report the mismatch and do not render
