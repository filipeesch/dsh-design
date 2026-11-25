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
