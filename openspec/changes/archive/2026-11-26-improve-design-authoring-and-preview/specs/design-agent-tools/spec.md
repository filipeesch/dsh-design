# Spec Delta

## MODIFIED Requirements

### Requirement: design_status
The `design_status` tool SHALL return whether a project exists, its folder, the pinned and installed kit versions, the screens with their IDs and files, error and warning counts, and the preview URL. It SHALL additionally return the entry, configured breakpoints, and usable named states and explicit branch selectors for each screen. Ordinary rendered output SHALL expose copyable selections. A non-launching browser readiness summary SHALL distinguish unverified readiness from confirmed success or failure and provide host/profile-specific remediation.

#### Scenario: Status without a project
- **WHEN** the agent calls `design_status` where no project exists
- **THEN** the result says the project is missing and names `design_init`, without failing

#### Scenario: Discover targets before capturing
- **WHEN** a project has a named state and an alternative branch
- **THEN** the ordinary result identifies the screen, state, branch selector, and breakpoint without requiring a source read

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

### Requirement: Variant-aware design inspection
Design status and validation SHALL surface variant groups, choices and branch diagnostics. Screen inspection, queries and screenshots SHALL use the chosen projection by default and accept an explicit branch selection for exploration. Browser checks SHALL use a single valid projection, and journeys and handoff SHALL default to chosen branches. Tool results that resolve a variant selection SHALL identify the effective projection; distinct rendered inputs SHALL NOT overwrite another projection's screenshot. Layout lint SHALL also accept an explicit branch selector and report its effective selection.

#### Scenario: Inspect an unchosen alternative
- **WHEN** the agent queries or captures an explicitly selected unchosen branch
- **THEN** the result identifies that branch, sees its specific nodes, and leaves the default chosen projection unchanged

#### Scenario: Reject an unknown selection argument
- **WHEN** a check request contains an unrecognized selection argument
- **THEN** the result identifies the argument and no default target is measured
