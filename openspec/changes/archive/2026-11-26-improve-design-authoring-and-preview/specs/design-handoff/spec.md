# Spec Delta

## MODIFIED Requirements

### Requirement: Chosen design handoff package
Handoff SHALL generate a local package for requested screens, default or named states, and configured breakpoints. It SHALL include editable DSX with only chosen branches, stable node identities, semantic layout snapshots with CSS-pixel boxes, canvas screenshots, resolved design tokens and relevant journey acceptance flows. The manifest SHALL describe the explicit rendering inputs, effective choices, dimensions and artifact locations. Handoff SHALL exclude non-chosen branches, discarded records, app captures, review drafts and DSH UI chrome. The exported configuration and bounded supporting chosen sources SHALL satisfy the selected designs and relevant journeys when reopened unchanged. The manifest SHALL distinguish supporting sources from selected evidence. Layouts and screenshots SHALL be produced only for the requested projection matrix. Invalid or stale source or an unresolvable selection SHALL fail explicitly rather than be represented as an accepted design. For selected screens and situations, the manifest or its referenced versioned-input export SHALL include relevant durable descriptions and labeled relationships. It SHALL identify illustrative and simulated relationships as such without exporting runnable simulation controls. A referenced destination outside the selected evidence SHALL NOT create an additional render or expand the existing executable source closure solely because it is an illustrative or simulated relationship.

#### Scenario: Generate a Mobile handoff for a named checkout state
- **WHEN** the agent requests checkout at the Mobile breakpoint with the review drawer state
- **THEN** the package describes that resolved state and includes its chosen source, layout, screenshot, tokens and acceptance flows with no discarded alternatives or comments

#### Scenario: Hand off one step of a larger review flow
- **WHEN** a selected screen has a durable summary and a simulated relationship to an unselected destination
- **THEN** the package preserves the contextual summary and the relationship's simulation label, excludes its preview action and session comments, and produces no extra evidence for the destination
