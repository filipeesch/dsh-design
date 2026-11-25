# design-headless-checks Specification

## Purpose

Measure the real kit layout, report actionable issues, and produce reproducible visual evidence without downloading external project resources.

## Requirements

### Requirement: Isolated reusable render sessions
Browser-backed checks SHALL reuse a warm browser for the same DSH session, isolate work from other sessions and the owner's browser state, reset the page state for each check, and release resources when the session or plugin ends. Checks SHALL render the same validated kit in deterministic mode without external resource requests. Missing Chromium, cancellation and timeouts SHALL be reported explicitly without false successful results.

#### Scenario: Repeated and parallel checks
- **WHEN** two checks run for one session and another session runs a check concurrently
- **THEN** the first session reuses its browser while each check has clean state and no session can see another's state

### Requirement: Semantic layout snapshot
For the selected screen, named state, and breakpoint the system SHALL report the rendered node identity and component, available role/name and visibility, and a computed box in CSS pixels relative to the canvas for each measured visible node. Geometry and node order SHALL be stable in the same browser environment. The snapshot SHALL use bounded output and retain meaningful identity and location when truncated.

#### Scenario: Inspect a responsive component
- **WHEN** the same declared stack is inspected at the mobile and desktop breakpoints
- **THEN** each result contains the actual computed boxes and identifies its breakpoint

### Requirement: Layout lint
Lint SHALL report measured canvas or container overflow, peer component overlap, clipped text, pointer controls with a target dimension under 44 CSS pixels, and validator off-token warnings. By default it SHALL check every configured breakpoint. It SHALL identify the rule, screen, breakpoint, involved nodes and measured evidence; intentional parent and child containment and intentional modal backdrops SHALL NOT constitute overlap.

#### Scenario: Identify layout issues on mobile
- **WHEN** a fixture contains overflow, overlap, clipped text, and an undersized control on mobile but is corrected on desktop
- **THEN** layout lint identifies the affected nodes and breakpoint without misreporting intended nesting

### Requirement: Deterministic screenshot artifacts
An explicit screenshot request SHALL produce a PNG of the rendered canvas for a chosen screen, state and breakpoint, optionally marking a chosen stable node. The artifact SHALL be written under the project's ignored cache with a deterministic name and SHALL be available to the requesting design session for inspection. The image SHALL NOT include DSH chrome or be written to versioned sources.

#### Scenario: Capture a specific node
- **WHEN** the agent requests a screenshot of the mobile checkout screen highlighting `filters`
- **THEN** the resulting PNG shows that canvas and highlights the target node, and the tool reports how to inspect it
