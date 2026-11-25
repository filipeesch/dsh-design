# design-agent-preset Specification

## Purpose

Defines the `design` agent preset: the tools and guidance a design session gets so the agent works in the edit, validate, view, and share loop by default.

## Requirements

### Requirement: Selectable design preset
DSH SHALL list a preset with ID `design`, a display name, and a description when the plugin is installed.

#### Scenario: Start a design session
- **WHEN** the user creates a session and selects the `design` preset
- **THEN** the session's agent has the design tools available

### Requirement: Tool composition
The preset SHALL include the standard file, shell, and search tools of the default preset plus every design tool.

#### Scenario: Edit and validate available
- **WHEN** an agent runs in the `design` preset
- **THEN** it can read and edit files with the standard tools and call `design_status`, `design_init`, `design_validate`, `design_view`, and `design_catalog`

### Requirement: Compact DSL guidance
The preset SHALL add a system prompt section that teaches the DSL essentials (syntax limits, required IDs, token props, the CSS escape policy, interaction references, file layout) in fewer than 6,000 characters, and SHALL direct the agent to `design_catalog` for component details instead of embedding the catalog.

#### Scenario: Prompt size
- **WHEN** the preset's prompt section is rendered
- **THEN** it is under 6,000 characters and contains no per-component prop tables

### Requirement: Working loop guidance
The guidance SHALL instruct the agent to check `design_status` first, scaffold with `design_init` when needed, edit design files directly with the standard tools, fix the diagnostics attached to its edits before continuing, inspect results with `design_view`, and share the preview URL with the user after meaningful changes.

#### Scenario: First turn in a repository without a design
- **WHEN** the user asks a `design` session to sketch a screen in a repository without a design project
- **THEN** the agent scaffolds the project, writes the screen, has no validation errors left, and replies with the preview URL

### Requirement: No extra write restrictions
The preset SHALL NOT add file write restrictions beyond the session's normal file policy; keeping edits inside the design folder SHALL be guidance only.

#### Scenario: Session file policy applies
- **WHEN** an agent in the `design` preset writes a file outside the design folder
- **THEN** the write is governed only by the session's normal file policy

### Requirement: Headless check guidance
The preset SHALL teach that fixtures must be fictitious, provide a compact path to named states and journey syntax, recommend running relevant journeys and layout lint when applicable, and recommend screenshots only when visual evidence is needed. These recommendations SHALL NOT become an enforced checklist or extra write restriction.

#### Scenario: Design check guidance
- **WHEN** the design agent receives the preset instructions
- **THEN** it can discover how to validate a journey and lint breakpoints without loading a per-component manual

### Requirement: Address review comments in the conversation
The preset SHALL teach the design agent to locate each submitted comment using its screen, breakpoint, interaction context, and node identity; apply the requested changes to the design text; and reply in chat with what changed or what could not be located. It SHALL explain that structural addresses may be stale. It SHALL NOT imply that comment drafts are versioned or available to a tool before submission.

#### Scenario: A batch contains a stale address
- **WHEN** the agent receives a batch containing a comment with an unresolved structural address
- **THEN** the guidance tells it to use the available context or ask for clarification, not silently apply the comment to a different component

### Requirement: Variant exploration and source promotion guidance
The preset SHALL show the agent how to author alternatives in the DSL, share and compare their preview, inspect them with design_diff, and promote the owner-selected winner by direct source edits. It SHALL instruct the agent to preserve ignored local discard records before the edit, verify the normal chosen projection after it, and clean records only on explicit owner request.

#### Scenario: Explore without changing the chosen design
- **WHEN** the agent is asked to try a new alternative
- **THEN** the guidance tells it to keep the current choice while preparing the comparison and wait for an explicit selection before promotion

### Requirement: Implementation handoff guidance
Design guidance SHALL explain how to generate and regenerate a chosen handoff on demand, validate the design and relevant journeys, and share the manifest path with the implementing agent. It SHALL distinguish the design contract from generated implementation code and keep generated output out of Git.

#### Scenario: Share the accepted design with an implementer
- **WHEN** the owner requests a contract for an accepted design selection
- **THEN** the Design agent uses the handoff tool and provides the artifact paths and acceptance flows without generating application code
