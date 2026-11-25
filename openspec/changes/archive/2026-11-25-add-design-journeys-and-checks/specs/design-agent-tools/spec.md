# Spec Delta

## ADDED Requirements

### Requirement: Journey, layout, and screenshot tools
The design preset SHALL expose `design_run_journey`, `design_lint`, and `design_screenshot` with structured inputs and outputs matching the journey and headless contracts. Tools SHALL distinguish invalid input, missing browser runtime, and valid runs with findings or assertion failures. PNG generation SHALL occur only on explicit request.

#### Scenario: Ordinary assertion failure
- **WHEN** a valid journey completes its browser work but fails an assertion
- **THEN** `design_run_journey` returns a structured failed result and the failure snapshot, not an infrastructure error

### Requirement: design_query
The `design_query` tool SHALL filter the validated design tree by optional screen, component type, exact scalar prop value and stable ID pattern. Result ordering SHALL be deterministic, bounded, and include screen, node identity and source location. The tool SHALL use no browser and SHALL NOT evaluate selectors or executable input.

#### Scenario: Locate inputs
- **WHEN** a query filters for component `Input` and a supported ID prefix pattern
- **THEN** matches are listed in stable screen and tree order with their source locations

## MODIFIED Requirements

### Requirement: design_view
The `design_view` tool SHALL return a compact text projection of a screen: one indented line per node with component type, ID or structural address, the props that affect appearance or behavior, and text content. It SHALL accept a maximum depth and a node ID to view only that subtree, and SHALL show overlays closed unless asked to show them open or opened by the selected named state. With an explicit breakpoint it SHALL include the computed semantic layout snapshot; without a breakpoint the existing text projection SHALL remain usable without Chromium. An explicit layout request with unavailable Chromium SHALL NOT silently return a static tree.

#### Scenario: View a subtree
- **WHEN** the agent calls `design_view` with screen `orders` and node `filters` open
- **THEN** the result shows only the `filters` subtree, expanded, with one line per node

#### Scenario: View calculated geometry
- **WHEN** the agent calls `design_view` with a valid named state and explicit mobile breakpoint
- **THEN** the result identifies the selected state and contains its measured node boxes
