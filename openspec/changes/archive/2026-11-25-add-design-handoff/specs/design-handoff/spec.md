# Spec Delta

## Purpose

Produce an on-demand implementation contract from a validated design, with reproducible layout evidence and acceptance journeys rather than generated application code.

## ADDED Requirements

### Requirement: Chosen design handoff package
Handoff SHALL generate a local package for requested screens, default or named states, and configured breakpoints. It SHALL include editable DSX with only chosen branches, stable node identities, semantic layout snapshots with CSS-pixel boxes, canvas screenshots, resolved design tokens and relevant journey acceptance flows. The manifest SHALL describe the explicit rendering inputs, effective choices, dimensions and artifact locations. Handoff SHALL exclude non-chosen branches, discarded records, app captures, review drafts and DSH UI chrome. The exported configuration and bounded supporting chosen sources SHALL satisfy the selected designs and relevant journeys when reopened unchanged. The manifest SHALL distinguish supporting sources from selected evidence. Layouts and screenshots SHALL be produced only for the requested projection matrix. Invalid or stale source or an unresolvable selection SHALL fail explicitly rather than be represented as an accepted design.

#### Scenario: Generate a Mobile handoff for a named checkout state
- **WHEN** the agent requests checkout at the Mobile breakpoint with the review drawer state
- **THEN** the package describes that resolved state and includes its chosen source, layout, screenshot, tokens and acceptance flows with no discarded alternatives or comments

### Requirement: Reproducible generated cache only
Handoff SHALL write only under the ignored handoff cache, using paths confined to the current design folder. Given the same validated source and effective render inputs, including compatible kit and browser environment, it SHALL produce an identical manifest and payload bytes independent of clock, absolute workspace path and session identity. Distinct effective inputs SHALL NOT overwrite an earlier output. Cancellation, invalid input or interrupted generation SHALL NOT expose a completed package. The tool SHALL NOT generate application code or require an external resource to render the design.

#### Scenario: Regenerate from identical sources
- **WHEN** the same valid design and selection are generated again with the same pinned rendering environment
- **THEN** the logical package identity and file bytes match, and deleting the ignored cache leaves all design sources intact
