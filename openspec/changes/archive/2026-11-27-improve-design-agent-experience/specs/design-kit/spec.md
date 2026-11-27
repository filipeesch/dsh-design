# design-kit delta

## MODIFIED Requirements

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

### Requirement: Inline disclosure
The kit SHALL offer an addressable Disclosure with a labeled toggle and an accessible expanded state. It SHALL reveal and hide its own child content in place, support an authored initial open or closed value and an optional alternate open label with the ordinary label as fallback, retain focus on activation, and keep instances independent. Collapsed content SHALL not be visible or keyboard-focusable. Disclosure SHALL NOT imply navigation or change the visibility of arbitrary other nodes.

#### Scenario: Expand one item among several
- **WHEN** a keyboard reviewer expands and collapses one FAQ answer
- **THEN** only that answer changes visibility, the expanded indicator updates, and focus remains usable

## ADDED Requirements

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
