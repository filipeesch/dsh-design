# Spec Delta

## Purpose

Describe repeatable interactions and assertions that an agent can execute against a rendered design before handing it to a person for review.

## ADDED Requirements

### Requirement: Declarative journey files
An optional `journeys/` directory SHALL contain one restricted JSX-style `Journey` per `.dsx` file with a unique ID, a start screen, an optional named state and optional configured breakpoint. The allowed steps SHALL be tap, type, choose, navigate, and assert screen, visibility, value, or count. Targets SHALL use stable design IDs, not arbitrary selectors. Unknown steps, invalid arguments, and invalid starting references SHALL produce source-located diagnostics; journeys SHALL NOT execute JavaScript or accept arbitrary URLs.

#### Scenario: Validate a journey
- **WHEN** a journey names an unknown start screen or uses an undeclared step
- **THEN** validation identifies the failing declaration before any browser action

### Requirement: Deterministic journey execution
Each run SHALL start from clean interaction state, take one validated project snapshot, and apply the declared steps in order against real preview controls. It SHALL stop at the first failed action or assertion and report ordered step outcomes, expected/observed values where applicable, and a bounded semantic snapshot of the failing screen. A project change during execution SHALL NOT alter the running snapshot.

#### Scenario: Walk a responsive checkout flow
- **WHEN** a journey opens a drawer, chooses a fixture-backed option, types a value, and taps a button to navigate
- **THEN** each step and assertion succeeds against the same UI available to a human

#### Scenario: Assertion fails
- **WHEN** a visible node is expected to be hidden
- **THEN** the result identifies the failing step and includes the screen snapshot, without executing later steps
