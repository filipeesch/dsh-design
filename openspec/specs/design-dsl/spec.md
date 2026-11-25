# design-dsl Specification

## Purpose

Defines the restricted JSX-style language agents write designs in, what it accepts and rejects, and the diagnostics it produces, so designs stay declarative, safe to interpret, and fast to correct.

## Requirements

### Requirement: JSX-style syntax without JavaScript
A screen file SHALL contain exactly one `Screen` root element written in JSX syntax. Prop values SHALL be limited to string literals, and inside braces to number, boolean, and `null` literals, arrays of literals, object literals of literals, token references, and the explicitly declared interaction and fixture references. A screen may declare named state metadata and collection templates using the documented DSL schema. Journey files SHALL use the same restricted JSX grammar and a distinct `Journey` root with typed step elements. Any other construct (imports, statements, identifiers other than allowed references, operators, template literals, arbitrary function calls, spread) MUST be rejected with a diagnostic and MUST NOT be executed.

#### Scenario: Valid screen
- **WHEN** a file contains `<Screen id="orders" title="Orders"><Text>Hello</Text></Screen>`
- **THEN** validation reports no errors and the screen renders

#### Scenario: JavaScript rejected
- **WHEN** a prop contains `{items.map(x => x)}` or a file contains an `import`
- **THEN** validation reports an error at that location stating that expressions are not allowed, and nothing in the file is evaluated

#### Scenario: Separate journey grammar
- **WHEN** a journey contains a supported assertion element with typed literal props
- **THEN** it is parsed as a journey step and is not treated as a renderable kit component

### Requirement: Known components and props
Every element SHALL name a kit component, and every prop SHALL be one the component declares. Enumerated props SHALL accept only their declared values.

#### Scenario: Unknown prop value
- **WHEN** a `Button` has `variant="prim"`
- **THEN** validation reports an error listing the valid variants and suggesting `primary`

#### Scenario: Unknown component
- **WHEN** a file uses `<Buton>`
- **THEN** validation reports an error suggesting `Button`

### Requirement: Stable node IDs
IDs SHALL match `[a-z][a-z0-9-]*` and be unique within a screen. An explicit `id` SHALL be required on `Screen`, on every interactive component, on every overlay, and on every element targeted by an interaction reference. Other nodes MAY omit it; such nodes SHALL receive a structural address that tools label as unstable.

#### Scenario: Missing required ID
- **WHEN** a `Drawer` has no `id`
- **THEN** validation reports an error requiring one

#### Scenario: Duplicate ID
- **WHEN** two nodes in one screen share an ID
- **THEN** validation reports an error naming both locations

### Requirement: Token-based style props
Style props (spacing, color, typography, radius, shadow, size) SHALL accept token paths of the matching token type. A token path that does not exist SHALL be an error. A raw literal (such as `#ff0000` or `13px`) in a style prop SHALL be accepted and reported as an off-token warning.

#### Scenario: Unknown token
- **WHEN** a node uses `gap="spacing.huge"` and no such token exists
- **THEN** validation reports an error listing the nearest existing spacing tokens

#### Scenario: Off-token value
- **WHEN** a node uses `color="#ff0000"`
- **THEN** the node renders with that color and validation reports an off-token warning

### Requirement: Responsive values
A prop that accepts a value SHALL also accept an object literal keyed by breakpoint names, applying each value from that breakpoint upwards.

#### Scenario: Responsive direction
- **WHEN** a `Stack` has `direction={{ mobile: "column", desktop: "row" }}`
- **THEN** it renders as a column below the desktop width and as a row at or above it

#### Scenario: Unknown breakpoint key
- **WHEN** a responsive object uses a key that is not a configured breakpoint
- **THEN** validation reports an error listing the configured breakpoints

### Requirement: Raw CSS escape hatch
Any component SHALL accept a `css` prop containing CSS declarations scoped to that node. Every use SHALL be reported as a warning so it stays visible. Selectors, at-rules, and `url()` values pointing outside the design folder MUST be rejected.

#### Scenario: Scoped declaration
- **WHEN** a `Card` has `css="border-left: 4px solid red"`
- **THEN** only that card gets the border and validation reports a raw-CSS warning naming the node

#### Scenario: Escaping the node rejected
- **WHEN** a `css` value contains `@import`, a selector block, or `url(https://...)`
- **THEN** validation reports an error and the value is not applied

### Requirement: Interaction references
Event props such as `onPress` SHALL accept only `open("<id>")`, `close("<id>")`, `toggle("<id>")`, and `navigate("<screen-id>")`. Each target MUST exist: overlay IDs within the same screen, screen IDs within the project.

#### Scenario: Valid reference
- **WHEN** a button has `onPress={open("filters")}` and the screen has a `Drawer id="filters"`
- **THEN** validation passes

#### Scenario: Dangling reference
- **WHEN** a button has `onPress={navigate("checkout")}` and no screen has ID `checkout`
- **THEN** validation reports an error naming the missing screen

### Requirement: Text is never markup
Text children and string props SHALL be rendered as text, never interpreted as HTML.

#### Scenario: HTML-looking text
- **WHEN** a `Text` contains `<b>bold</b>` as an escaped string
- **THEN** the preview shows the literal characters and no bold element is created

### Requirement: Local assets only
Image sources SHALL be paths inside the design folder or a placeholder description. Remote URLs MUST be rejected.

#### Scenario: Remote image
- **WHEN** an `Image` has `src="https://example.com/a.png"`
- **THEN** validation reports an error suggesting a local file or a placeholder

### Requirement: Diagnostics
Validation SHALL report all diagnostics of a file in one pass. Each diagnostic SHALL include severity (`error` or `warning`), file path, line, column, node ID when known, a message, and a suggested fix when one exists. Diagnostics SHALL be ordered by file, then line, then column.

#### Scenario: Several errors in one file
- **WHEN** a file has three independent errors
- **THEN** one validation run returns all three, in source order, each with line and column

### Requirement: Declarative variant groups
The DSL SHALL accept a Variants element with a stable group ID and a chosen branch ID, containing at least two Variant children with distinct branch IDs. A whole-screen branch SHALL contain one Screen rooted at the same screen identity; a subtree branch SHALL contain ordinary legal children for that position. Nested groups SHALL be addressable independently. Neither wrapper SHALL become a rendered element. Every branch SHALL be parsed and validated, including non-chosen branches. A stable node ID MAY repeat across mutually exclusive branches but SHALL remain unique in any single resolved screen. Invalid group structure, absent choices, conflicting IDs or unusable references SHALL produce source-located diagnostics without corrupting the last valid preview.

#### Scenario: Reuse an ID in mutually exclusive alternatives
- **WHEN** both branches define the same action ID in alternative presentations and no other visible component shares it
- **THEN** both branches validate and resolving one exposes exactly one node with that ID

#### Scenario: Unchosen branch is malformed
- **WHEN** an alternate contains a duplicate active node ID or a dangling local reference
- **THEN** validation identifies the invalid branch and source location even though it is not chosen
