# Spec Delta

## MODIFIED Requirements

### Requirement: Layout lint
Lint SHALL report measured canvas or container overflow, peer component overlap, clipped text, pointer controls with a target dimension under 44 CSS pixels, and validator off-token warnings. By default it SHALL check every configured breakpoint. It SHALL identify the rule, screen, breakpoint, involved nodes and measured evidence; intentional parent and child containment and intentional modal backdrops SHALL NOT constitute overlap. Lint SHALL use the requested screen and optional named state and variant. Even if there are no findings, the result SHALL identify the actual screen, effective state and branch, and each breakpoint measured.

#### Scenario: Identify layout issues on mobile
- **WHEN** a fixture contains overflow, overlap, clipped text, and an undersized control on mobile but is corrected on desktop
- **THEN** layout lint identifies the affected nodes and breakpoint without misreporting intended nesting

#### Scenario: Measure the requested alternative
- **WHEN** the chosen branch fits and an explicitly selected alternative overflows at one configured breakpoint
- **THEN** the result identifies the alternative and the failing breakpoint and does not claim that unmeasured projections ran

### Requirement: Deterministic screenshot artifacts
An explicit screenshot request SHALL produce a PNG of the rendered canvas for a chosen screen, state and breakpoint, optionally marking a chosen stable node. The artifact SHALL be written under the project's ignored cache with a deterministic name and SHALL be available to the requesting design session for inspection. The image SHALL NOT include DSH chrome or be written to versioned sources. The capture SHALL honor and identify the effective variant as well as the screen, state, and breakpoint.

#### Scenario: Capture a specific node
- **WHEN** the agent requests a screenshot of the mobile checkout screen highlighting `filters`
- **THEN** the resulting PNG shows that canvas and highlights the target node, and the tool reports how to inspect it

#### Scenario: Capture an explicit alternative
- **WHEN** a reviewer captures a valid unchosen branch
- **THEN** the image and reported selection match the chosen request without changing the default branch

## ADDED Requirements

### Requirement: Render media diagnostics
Headless visual checks SHALL identify missing, unsupported, or undecodable referenced media separately from layout findings, with an affected source or node and a usable remediation. A media failure SHALL NOT be represented solely as clipping or overflow caused by fallback rendering. The passive-raster and offline boundaries SHALL remain in force.

#### Scenario: Unsupported artwork does not look like a geometry fault
- **WHEN** the browser would show fallback text for a referenced unsupported SVG
- **THEN** the check identifies unavailable media and removing fallback text does not make the asset valid
