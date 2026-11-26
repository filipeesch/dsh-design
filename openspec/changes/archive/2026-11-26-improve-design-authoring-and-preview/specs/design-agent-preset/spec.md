# Spec Delta

## MODIFIED Requirements

### Requirement: Working loop guidance
The guidance SHALL instruct the agent to check `design_status` first, scaffold with `design_init` when needed, edit design files directly with the standard tools, fix the diagnostics attached to its edits before continuing, inspect results with `design_view`, and share the preview URL with the user after meaningful changes. The guidance SHALL point to batched catalog lookups and composition recipes. It SHALL prefer built-in semantic controls, prepare the important interactive path when it is clear, and ask only when ambiguity would materially change the experience. It SHALL distinguish durable project context from session review comments.

#### Scenario: First turn in a repository without a design
- **WHEN** the user asks a `design` session to sketch a screen in a repository without a design project
- **THEN** the agent scaffolds the project, writes the screen, has no validation errors left, and replies with the preview URL

#### Scenario: Prepare a clear primary path
- **WHEN** a design task identifies an unambiguous main path and leaves peripheral behavior unspecified
- **THEN** the guidance directs the agent to connect the main path and label illustrative behavior instead of inventing business rules

### Requirement: Headless check guidance
The preset SHALL teach that fixtures must be fictitious, provide a compact path to named states and journey syntax, recommend running relevant journeys and layout lint when applicable, and recommend screenshots only when visual evidence is needed. These recommendations SHALL NOT become an enforced checklist or extra write restriction. The guidance SHALL recommend a representative visual check early in UI reconstruction before repeating layout patterns. It SHALL distinguish valid source, measured geometry, and visual fidelity and explain the fallback when browser or inline image delivery is unavailable.

#### Scenario: Design check guidance
- **WHEN** the design agent receives the preset instructions
- **THEN** it can discover how to validate a journey and lint breakpoints without loading a per-component manual

#### Scenario: Do not equate clean lint with fidelity
- **WHEN** an agent reconstructs an existing UI
- **THEN** the guidance calls for visual inspection rather than treating clean validation or lint as evidence of fidelity
