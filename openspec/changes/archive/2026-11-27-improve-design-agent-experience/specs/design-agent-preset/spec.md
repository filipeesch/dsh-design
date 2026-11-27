# design-agent-preset delta

## MODIFIED Requirements

### Requirement: Working loop guidance
The guidance SHALL instruct the agent to check `design_status` first, scaffold with `design_init` when needed, edit design files directly with the standard tools, fix the diagnostics attached to its edits before continuing, inspect results with `design_view`, and share the preview URL with the user after meaningful changes. The guidance SHALL point to batched catalog lookups and composition recipes. It SHALL prefer built-in semantic controls, prepare the important interactive path when it is clear, and ask only when ambiguity would materially change the experience. It SHALL distinguish durable project context from session review comments. It SHALL direct agents to search the catalog by intent when a canonical name is unknown and discover local recipes and shared layouts without copying shared source.

#### Scenario: First turn in a repository without a design
- **WHEN** the user asks a `design` session to sketch a screen in a repository without a design project
- **THEN** the agent scaffolds the project, writes the screen, has no validation errors left, and replies with the preview URL

#### Scenario: Prepare a clear primary path
- **WHEN** a design task identifies an unambiguous main path and leaves peripheral behavior unspecified
- **THEN** the guidance directs the agent to connect the main path and label illustrative behavior instead of inventing business rules

### Requirement: Headless check guidance
The preset SHALL teach that fixtures must be fictitious, provide a compact path to named states and journey syntax, recommend running relevant journeys and layout lint when applicable, and recommend screenshots only when visual evidence is needed. These recommendations SHALL NOT become an enforced checklist or extra write restriction. The guidance SHALL recommend a representative visual check early in UI reconstruction before repeating layout patterns. It SHALL recommend focused measurements or comparisons for geometry and distinguish valid source, measured geometry, and visual fidelity and explain the fallback when browser or inline image delivery is unavailable.

#### Scenario: Design check guidance
- **WHEN** the design agent receives the preset instructions
- **THEN** it can discover how to validate a journey and lint breakpoints without loading a per-component manual

#### Scenario: Do not equate clean lint with fidelity
- **WHEN** an agent reconstructs an existing UI
- **THEN** the guidance calls for visual inspection rather than treating clean validation or lint as evidence of fidelity

### Requirement: Address review comments in the conversation
The preset SHALL teach the design agent to locate each submitted comment using its screen, breakpoint, theme, interaction context, and node identity; apply the requested changes to the design text; and reply in chat with what changed or what could not be located. It SHALL explain that structural addresses may be stale. It SHALL NOT imply that comment drafts are versioned or available to a tool before submission.

#### Scenario: A batch contains a stale address
- **WHEN** the agent receives a batch containing a comment with an unresolved structural address
- **THEN** the guidance tells it to use the available context or ask for clarification, not silently apply the comment to a different component

## ADDED Requirements

### Requirement: Path-only design delivery guidance
The guidance SHALL direct the agent to share existing accessible paths, the accepted selection and checks, and a source revision when relevant, without generating a delivery export or suggesting that a local cache path grants access to another workspace. The agent SHALL distinguish a session preview link from a versioned design source.

#### Scenario: Deliver accepted work to an implementer
- **WHEN** the owner asks where the approved design is
- **THEN** guidance directs the agent to share accessible existing files or evidence and the accepted selection without packaging them again

## REMOVED Requirements

### Requirement: Implementation handoff guidance
**Reason**: Delivery no longer generates a reproducible package.
**Migration**: Follow the path-only guidance for the accepted design.
