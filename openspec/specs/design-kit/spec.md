# design-kit Specification

## Purpose

Defines the component kit that renders designs: which standard web components exist, how tokens theme them, how they behave when clicked, and how rendering stays deterministic and machine-readable.

## Requirements

### Requirement: Base component set
The kit SHALL provide at least: `Screen`, `Stack`, `Grid`, `Box`, `Spacer`, `Divider`, `Header`, `Text`, `Icon`, `Image`, `Avatar`, `Badge`, `Button` (variants `primary`, `secondary`, `ghost`, `danger`, `link`; sizes; icon-only), `IconButton`, `Input`, `TextArea`, `Select`, `MultiSelect`, `Combobox`, `Checkbox`, `Radio`, `Switch`, `Tabs` and `Tab`, `Card`, `List` and `ListItem`, `Table`, `Drawer`, `Modal`, `Popover`, `Tooltip`, `Toast`, `Menu`, `Breadcrumbs`, `Pagination`, `Progress`, `Skeleton`, `EmptyState`, `CodeBlock`, `Callout`, `ToggleButton`, `SelectButton`, and `SplitButton`.

#### Scenario: Catalog completeness
- **WHEN** the catalog lists components
- **THEN** every component above appears with its props, variants, defaults, and an example

### Requirement: Token theming
Every visual property of kit components SHALL derive from the project's tokens or from explicit props. Changing a token SHALL change every component that uses it on the next render. The same authored nodes SHALL consume the effective palette, including component defaults for surfaces, text, borders, focus, selected states, and status tones. Light and dark styling SHALL NOT change control semantics.

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

### Requirement: Semantic presentation options
The kit SHALL offer opt-in compact tab presentation and compact icon controls using declared or token-backed styling while preserving existing defaults. Styling SHALL NOT change selected state, accessible names, keyboard operation, or semantic roles.

#### Scenario: Restyle tabs without substituting navigation
- **WHEN** a reviewer selects a compact tab with the keyboard
- **THEN** the tab retains its semantic role and switches its panel in place

### Requirement: Inline disclosure
The kit SHALL offer an addressable Disclosure with a labeled toggle and an accessible expanded state. It SHALL reveal and hide its own child content in place, support an authored initial open or closed value and an optional alternate open label with the ordinary label as fallback, retain focus on activation, and keep instances independent. Collapsed content SHALL not be visible or keyboard-focusable. Disclosure SHALL NOT imply navigation or change the visibility of arbitrary other nodes.

#### Scenario: Expand one item among several
- **WHEN** a keyboard reviewer expands and collapses one FAQ answer
- **THEN** only that answer changes visibility, the expanded indicator updates, and focus remains usable

### Requirement: Code and inline feedback components
CodeBlock SHALL render literal text with authored whitespace preserved, using monospace and either wrapping or internal horizontal scrolling without widening the surrounding canvas. Callout SHALL present a persistent inline title and body with a token-backed tone; it SHALL NOT act as a modal or require a timer.

#### Scenario: Read a log and an inline failure notice
- **WHEN** a narrow drawer contains a CodeBlock with a long indented log line and a warning Callout
- **THEN** the text retains its line breaks and indentation, the log does not widen the canvas, and the notice remains readable without dismissing an overlay

### Requirement: Semantic stateful action controls
ToggleButton SHALL expose a pressed boolean and a meaningful accessible name. SelectButton SHALL expose a single selected option from declared values, with pointer and keyboard selection independent of tab navigation. Switch SHALL offer an opt-in visual switch style without changing the existing default, checked state, accessible name, or keyboard operation. All SHALL honor their declared disabled behavior.

#### Scenario: Change a setting and select a display option
- **WHEN** a keyboard user activates a visual Switch, presses a ToggleButton, and selects a different segment
- **THEN** the controls announce their independent state changes without navigating or switching a tab panel

### Requirement: Anchored popovers and split actions
Popover SHALL support an explicit stable anchor in the same screen and remain within the selected canvas when the preferred placement does not fit; a Popover without an authored anchor SHALL retain its centered behavior. SplitButton SHALL provide independent primary and menu triggers, present declared alternative actions in an anchored menu, support keyboard selection and dismissal, and SHALL NOT execute the primary action on opening or dismissing the menu. Toast interaction SHALL remain unchanged.

#### Scenario: Use an anchored menu near an edge
- **WHEN** a reviewer opens the split menu at a narrow breakpoint and selects an alternative using the keyboard
- **THEN** the menu stays usable inside the canvas and dispatches only the selected alternative

### Requirement: Responsive drawer and field sizing
Drawer SHALL honor declared responsive, token-backed width while fitting the canvas. An Input SHALL offer a responsive opt-in to occupy the remaining width in a row while preserving its label and avoiding overflow. Omitted options SHALL preserve existing defaults. Overlay presentation options advertised for existing overlay components SHALL agree with their rendered behavior or be documented accurately.

#### Scenario: Adapt a drawer and repository field across widths
- **WHEN** an author selects a wider Drawer and a growing Input next to an action at desktop
- **THEN** the requested drawer width applies within canvas bounds and the field fills available space without pushing the action outside the row
