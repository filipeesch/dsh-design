# Design agent tools delta

## MODIFIED Requirements

### Requirement: design_status
The `design_status` tool SHALL return whether a project exists, its folder, the pinned and installed kit versions, the screens with their IDs and files, error and warning counts, and the preview URL. It SHALL distinguish the running plugin build identifier (and release version when available) from the kit versions and SHALL NOT present a version on disk as the active build. It SHALL list declared themes and journey IDs with their starting selections and usability. It SHALL additionally return the entry, configured breakpoints, and usable named states and explicit branch selectors for each screen. Ordinary rendered output SHALL expose copyable selections. A non-launching browser readiness summary SHALL distinguish unverified readiness from confirmed success or failure and provide host/profile-specific remediation.

#### Scenario: Status without a project
- **WHEN** the agent calls `design_status` where no project exists
- **THEN** the result says the project is missing and names `design_init`, without failing

#### Scenario: Discover targets before capturing
- **WHEN** a project has a named state and an alternative branch
- **THEN** the ordinary result identifies the screen, state, branch selector, and breakpoint without requiring a source read

#### Scenario: Identify the active build and available journeys
- **WHEN** the bundle on disk differs from the build currently serving the session
- **THEN** status identifies the running build, not the on-disk replacement, and lists usable or blocked journeys without launching Chromium

### Requirement: design_validate
The `design_validate` tool SHALL validate the whole project, one file, or one screen, and return the diagnostics defined by the DSL capability, including token, config, and cross-screen reference checks. An omitted scope SHALL be inferred from a sole file or screen argument; no arguments SHALL select the project. Missing, conflicting, out-of-project, or nonexistent targets SHALL produce a distinct invalid-selection result, never a clean report. File scope SHALL use design-folder-relative source paths. Screen scope SHALL include diagnostics from shared sources that affect that screen.

#### Scenario: Validate one screen
- **WHEN** the agent calls `design_validate` for screen `orders`
- **THEN** the result contains every diagnostic of that screen and of the tokens it references

#### Scenario: Validate an invalid screen target
- **WHEN** a caller passes an unknown screen or combines project scope with a file target
- **THEN** the tool explains the invalid selection rather than returning no diagnostics

### Requirement: design_view
The `design_view` tool SHALL return a compact text projection of a screen: one indented line per node with component type, ID or structural address, the props that affect appearance or behavior, and text content. It SHALL accept a maximum depth and a node ID to view only that subtree, and SHALL show overlays closed unless asked to show them open or opened by the selected named state. With an explicit breakpoint it SHALL include the computed semantic layout snapshot; without a breakpoint the existing text projection SHALL remain usable without Chromium. An explicit layout request with unavailable Chromium SHALL NOT silently return a static tree. A subtree request SHALL focus both the text and measured layout; text-only controls SHALL NOT silently change render state. A geometry-only mode SHALL support explicit stable node IDs and bounded batches of selections for a single screen and variant. Each measured case SHALL specify a breakpoint, use one current source snapshot for the call, and identify the effective selection, including its theme. Cases SHALL be ordered as requested and SHALL NOT generate images. Exact-ID focus SHALL distinguish absent nodes from nodes that have no visible box in the selected state.

#### Scenario: View a subtree
- **WHEN** the agent calls `design_view` with screen `orders` and node `filters` open
- **THEN** the result shows only the `filters` subtree, expanded, with one line per node

#### Scenario: View calculated geometry
- **WHEN** the agent calls `design_view` with a valid named state and explicit mobile breakpoint
- **THEN** the result identifies the selected state and contains its measured node boxes

#### Scenario: Compare two states without dumping the tree
- **WHEN** a caller selects the same stable IDs in two explicit measured cases
- **THEN** the ordinary and structured results identify each case and return only the requested geometry or visibility status, not the full tree or a PNG

### Requirement: design_catalog
The `design_catalog` tool SHALL list kit components with one-line descriptions, and for a named component SHALL return its props with types, allowed values, defaults, and a minimal example. An unknown name SHALL return the closest component names. It SHALL also accept a bounded batch of names and provide a compact index of supported non-component DSL constructs and composition recipes. A batch SHALL preserve request order with an individual result or suggestions per name. Each matched detail SHALL identify its kind and include an example valid in its declared context. A separate intent search mode SHALL accept Portuguese and English terms, produce deterministic bounded matches with canonical names and kinds, and explicitly report no relevant match. Index, exact lookup, ordered batch lookup, and intent search SHALL NOT be silently combined. Details SHALL link related constructs and recipes where they add capability or composition context.

#### Scenario: Component details
- **WHEN** the agent calls `design_catalog` with `Select`
- **THEN** the result lists every `Select` prop and a valid example snippet

#### Scenario: Batch mixed reference lookups
- **WHEN** a batch requests Tabs, ItemTemplate, a composition recipe, and a misspelled name
- **THEN** the tool returns distinct matching details and suggestions only for the misspelled entry

#### Scenario: Find a composition without knowing its name
- **WHEN** the agent searches for a table with fictitious data in Portuguese or in English
- **THEN** the result surfaces the applicable fixture composition and the canonical lookup name without requiring a full index

### Requirement: Journey, layout, and screenshot tools
The design preset SHALL expose `design_run_journey`, `design_lint`, and `design_screenshot` with structured inputs and outputs matching the journey and headless contracts. Tools SHALL distinguish invalid input, missing browser runtime, and valid runs with findings or assertion failures. PNG generation SHALL occur only on explicit request. A screenshot response SHALL return the artifact location and, when the model and transport support images, include the captured image in that response. Otherwise it SHALL provide a usable artifact inspection path. Browser-facing check and capture tools SHALL reject unknown or incompatible arguments and SHALL NOT silently substitute a different target. Their canonical results and ordinary tool output SHALL preserve the difference between invalid selection, browser unavailable, timeout, cancellation, and completed checks with findings or failed assertions. Actionable failures SHALL name the affected selection or journey step and target when available.

#### Scenario: Ordinary assertion failure
- **WHEN** a valid journey completes its browser work but fails an assertion
- **THEN** `design_run_journey` returns a structured failed result and the failure snapshot, not an infrastructure error

#### Scenario: Inspect evidence from the first response
- **WHEN** the agent explicitly requests a valid screenshot on an image-capable route
- **THEN** the tool returns the actual capture and its artifact path and identifies its effective selection

### Requirement: design_query
The `design_query` tool SHALL filter the validated design tree by optional screen, component type, exact scalar prop value and stable ID pattern. Result ordering SHALL be deterministic, bounded, and include screen, node identity and source location. The tool SHALL use no browser and SHALL NOT evaluate selectors or executable input. It SHALL search all chosen screen trees by default, require an explicit screen for an alternate branch, and identify the effective selection in the ordinary result. A prop and scalar value SHALL be supplied together for exact-value matching. State, theme, breakpoint, and malformed variant arguments SHALL NOT be interpreted as structural filters.

#### Scenario: Locate inputs
- **WHEN** a query filters for component `Input` and a supported ID prefix pattern
- **THEN** matches are listed in stable screen and tree order with their source locations

#### Scenario: Prevent an ambiguous alternate-branch search
- **WHEN** a caller provides a variant without a screen or supplies a breakpoint
- **THEN** the result explains which structural arguments are supported and does not perform a broader search

### Requirement: Variant-aware design inspection
Design status and validation SHALL surface variant groups, choices and branch diagnostics. Screen inspection, queries and screenshots SHALL use the chosen projection by default and accept an explicit branch selection for exploration. Browser checks SHALL use a single valid projection, and journeys SHALL default to chosen branches. Tool results that resolve a variant selection SHALL identify the effective projection; distinct rendered inputs SHALL NOT overwrite another projection's screenshot. Layout lint SHALL also accept an explicit branch selector and report its effective selection.

#### Scenario: Inspect an unchosen alternative
- **WHEN** the agent queries or captures an explicitly selected unchosen branch
- **THEN** the result identifies that branch, sees its specific nodes, and leaves the default chosen projection unchanged

#### Scenario: Reject an unknown selection argument
- **WHEN** a check request contains an unrecognized selection argument
- **THEN** the result identifies the argument and no default target is measured

## ADDED Requirements

### Requirement: Path-only delivery tool surface
The Design preset SHALL NOT register a dedicated implementation export tool or generate a handoff package when delivering a design. It SHALL retain the existing authoring and inspection tools other than the removed export tool. Existing generated exports SHALL NOT be migrated or deleted by the plugin.

#### Scenario: Inspect the installed tool inventory
- **WHEN** the owner opens Design and Standard sessions with the updated bundle
- **THEN** Design exposes the ten remaining design tools, Standard does not gain design tools, and neither registers `design_handoff`

## REMOVED Requirements

### Requirement: Design handoff tool contract
**Reason**: Design delivery now points to existing source and evidence rather than generating a separate implementation package.
**Migration**: Share accessible project-relative files and the accepted screen, state, theme, and variant, with a source revision when relevant. Keep existing exports as ordinary files.
