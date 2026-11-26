# design-agent-tools Specification

## Purpose

Defines the model-facing tools a design agent uses to create, inspect, and validate designs, and the automatic validation that follows every edit, so the agent can iterate quickly with deterministic feedback.

## Requirements

### Requirement: Structured, deterministic results
Every design tool SHALL return a structured value usable from programmatic tool calling, plus a concise human-readable rendering. For the same project content and arguments, results MUST be identical.

#### Scenario: Repeated call
- **WHEN** a design tool is called twice with the same arguments on unchanged files
- **THEN** both results are identical

### Requirement: design_init
The `design_init` tool SHALL scaffold a design project in the session's working directory and return the created paths and the preview URL. It SHALL refuse when a project already exists.

#### Scenario: Init
- **WHEN** the agent calls `design_init` in a repository without a design project
- **THEN** the project is scaffolded and the result lists the created files and the preview URL

### Requirement: design_status
The `design_status` tool SHALL return whether a project exists, its folder, the pinned and installed kit versions, the screens with their IDs and files, error and warning counts, and the preview URL. It SHALL additionally return the entry, configured breakpoints, and usable named states and explicit branch selectors for each screen. Ordinary rendered output SHALL expose copyable selections. A non-launching browser readiness summary SHALL distinguish unverified readiness from confirmed success or failure and provide host/profile-specific remediation.

#### Scenario: Status without a project
- **WHEN** the agent calls `design_status` where no project exists
- **THEN** the result says the project is missing and names `design_init`, without failing

#### Scenario: Discover targets before capturing
- **WHEN** a project has a named state and an alternative branch
- **THEN** the ordinary result identifies the screen, state, branch selector, and breakpoint without requiring a source read

### Requirement: design_validate
The `design_validate` tool SHALL validate the whole project, one file, or one screen, and return the diagnostics defined by the DSL capability, including token, config, and cross-screen reference checks.

#### Scenario: Validate one screen
- **WHEN** the agent calls `design_validate` for screen `orders`
- **THEN** the result contains every diagnostic of that screen and of the tokens it references

### Requirement: design_view
The `design_view` tool SHALL return a compact text projection of a screen: one indented line per node with component type, ID or structural address, the props that affect appearance or behavior, and text content. It SHALL accept a maximum depth and a node ID to view only that subtree, and SHALL show overlays closed unless asked to show them open or opened by the selected named state. With an explicit breakpoint it SHALL include the computed semantic layout snapshot; without a breakpoint the existing text projection SHALL remain usable without Chromium. An explicit layout request with unavailable Chromium SHALL NOT silently return a static tree.

#### Scenario: View a subtree
- **WHEN** the agent calls `design_view` with screen `orders` and node `filters` open
- **THEN** the result shows only the `filters` subtree, expanded, with one line per node

#### Scenario: View calculated geometry
- **WHEN** the agent calls `design_view` with a valid named state and explicit mobile breakpoint
- **THEN** the result identifies the selected state and contains its measured node boxes

### Requirement: design_catalog
The `design_catalog` tool SHALL list kit components with one-line descriptions, and for a named component SHALL return its props with types, allowed values, defaults, and a minimal example. An unknown name SHALL return the closest component names. It SHALL also accept a bounded batch of names and provide a compact index of supported non-component DSL constructs and composition recipes. A batch SHALL preserve request order with an individual result or suggestions per name. Each matched detail SHALL identify its kind and include an example valid in its declared context.

#### Scenario: Component details
- **WHEN** the agent calls `design_catalog` with `Select`
- **THEN** the result lists every `Select` prop and a valid example snippet

#### Scenario: Batch mixed reference lookups
- **WHEN** a batch requests Tabs, ItemTemplate, a composition recipe, and a misspelled name
- **THEN** the tool returns distinct matching details and suggestions only for the misspelled entry

### Requirement: Automatic validation after edits
After any tool call that changes design sources, the plugin SHALL surface new or resolved diagnostics affecting those changes, regardless of which tool wrote the files. Each automatic report SHALL be bounded with counts and actionable locations, and nested changes SHALL be reported on the enclosing call. An unrelated call or an edit with no diagnostic change SHALL NOT emit a clean-result notice. Explicit validation SHALL continue to report the complete requested scope.

#### Scenario: Edit introduces an error
- **WHEN** the agent edits a screen file with the generic edit tool and leaves an unknown prop
- **THEN** the edit result includes the diagnostic for that prop

#### Scenario: Unrelated tool call
- **WHEN** the agent runs a shell command that changes no design file
- **THEN** its result has no design validation attached

#### Scenario: Silent clean edit after a repair
- **WHEN** the agent repairs an invalid token, then makes a valid layout edit with no diagnostic change
- **THEN** the repair is surfaced once and the clean edit emits no automatic notice

### Requirement: Journey, layout, and screenshot tools
The design preset SHALL expose `design_run_journey`, `design_lint`, and `design_screenshot` with structured inputs and outputs matching the journey and headless contracts. Tools SHALL distinguish invalid input, missing browser runtime, and valid runs with findings or assertion failures. PNG generation SHALL occur only on explicit request. A screenshot response SHALL return the artifact location and, when the model and transport support images, include the captured image in that response. Otherwise it SHALL provide a usable artifact inspection path. Browser-facing check and capture tools SHALL reject unknown or incompatible arguments and SHALL NOT silently substitute a different target.

#### Scenario: Ordinary assertion failure
- **WHEN** a valid journey completes its browser work but fails an assertion
- **THEN** `design_run_journey` returns a structured failed result and the failure snapshot, not an infrastructure error

#### Scenario: Inspect evidence from the first response
- **WHEN** the agent explicitly requests a valid screenshot on an image-capable route
- **THEN** the tool returns the actual capture and its artifact path and identifies its effective selection

### Requirement: design_query
The `design_query` tool SHALL filter the validated design tree by optional screen, component type, exact scalar prop value and stable ID pattern. Result ordering SHALL be deterministic, bounded, and include screen, node identity and source location. The tool SHALL use no browser and SHALL NOT evaluate selectors or executable input.

#### Scenario: Locate inputs
- **WHEN** a query filters for component `Input` and a supported ID prefix pattern
- **THEN** matches are listed in stable screen and tree order with their source locations

### Requirement: Read-only semantic design diff
The design_diff tool SHALL compare two branch selections of the same screen or the chosen projections of that screen at two locally available Git revisions. It SHALL report deterministic additions, removals, moves, and changes to node type, props or text using stable IDs where available. Structural fallback SHALL be labeled; uncertain moves SHALL NOT be claimed as stable matches. Invalid selections, unavailable revisions and absent screens SHALL return actionable diagnostics. The tool SHALL NOT check out revisions, write project files, fetch remote history, or require Chromium.

#### Scenario: Compare reordered branches
- **WHEN** an owner compares two valid alternatives with the same stable button ID moved into another container and given a new label
- **THEN** design_diff identifies the move and label change without reporting the stable node as removed and added

#### Scenario: Compare two Git revisions without a checkout
- **WHEN** the agent requests a comparison of the screen at two available revisions while the worktree has uncommitted edits
- **THEN** the result uses the selected local revisions and the uncommitted edits and checkout remain unchanged

### Requirement: Variant-aware design inspection
Design status and validation SHALL surface variant groups, choices and branch diagnostics. Screen inspection, queries and screenshots SHALL use the chosen projection by default and accept an explicit branch selection for exploration. Browser checks SHALL use a single valid projection, and journeys and handoff SHALL default to chosen branches. Tool results that resolve a variant selection SHALL identify the effective projection; distinct rendered inputs SHALL NOT overwrite another projection's screenshot. Layout lint SHALL also accept an explicit branch selector and report its effective selection.

#### Scenario: Inspect an unchosen alternative
- **WHEN** the agent queries or captures an explicitly selected unchosen branch
- **THEN** the result identifies that branch, sees its specific nodes, and leaves the default chosen projection unchanged

#### Scenario: Reject an unknown selection argument
- **WHEN** a check request contains an unrecognized selection argument
- **THEN** the result identifies the argument and no default target is measured

### Requirement: Design handoff tool contract
The Design preset SHALL expose design_handoff with structured status, project-relative artifact references, actionable diagnostics and a bounded summary. It SHALL use validated current chosen projections independently of the transient preview and without requiring an external application. Other presets SHALL NOT gain the tool by default; their agents can read the package through authorized standard tools.

#### Scenario: Use a handoff from a coding session
- **WHEN** the design agent generates a package and shares its project-relative manifest path with the implementing agent
- **THEN** the implementing agent can read the contract using normal file access without changing presets

### Requirement: Live app capture release gate

The production plugin SHALL NOT include a live app capture runtime or expose live app capture tooling or guidance until independent end-to-end testing of the exact installed package on an owner-approved runtime verifies a successful capture with both OS-enforced browser network isolation and Chromium sandboxing intact. Local design previews and implementation handoff SHALL remain independent of live app capture.

#### Scenario: Release without verified live app capture

- **WHEN** the production bundle has no verified live app capture runtime
- **THEN** the bundle contains no live app capture worker or service, neither Design nor Standard exposes a live app capture tool, and local preview and implementation handoff remain available without that runtime
