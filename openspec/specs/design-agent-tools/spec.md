# design-agent-tools Specification

## Purpose

Defines the model-facing tools a design agent uses to create, inspect, and validate designs, and the automatic validation that follows every edit, so the agent can iterate quickly with deterministic feedback.

## Requirements

### Requirement: Structured, deterministic results
Every design tool SHALL return a structured value usable from programmatic tool calling, plus a concise human-readable rendering. For the same project content and arguments, results MUST be identical.

#### Scenario: Repeated call
- **WHEN** a design tool is called twice with the same arguments on unchanged files
- **THEN** both results are identical

### Requirement: design_init
The `design_init` tool SHALL scaffold a design project in the session's working directory and return the created paths and the preview URL. It SHALL refuse when a project already exists.

#### Scenario: Init
- **WHEN** the agent calls `design_init` in a repository without a design project
- **THEN** the project is scaffolded and the result lists the created files and the preview URL

### Requirement: design_status
The `design_status` tool SHALL return whether a project exists, its folder, the pinned and installed kit versions, the screens with their IDs and files, error and warning counts, and the preview URL.

#### Scenario: Status without a project
- **WHEN** the agent calls `design_status` where no project exists
- **THEN** the result says the project is missing and names `design_init`, without failing

### Requirement: design_validate
The `design_validate` tool SHALL validate the whole project, one file, or one screen, and return the diagnostics defined by the DSL capability, including token, config, and cross-screen reference checks.

#### Scenario: Validate one screen
- **WHEN** the agent calls `design_validate` for screen `orders`
- **THEN** the result contains every diagnostic of that screen and of the tokens it references

### Requirement: design_view
The `design_view` tool SHALL return a compact text projection of a screen: one indented line per node with component type, ID or structural address, the props that affect appearance or behavior, and text content. It SHALL accept a maximum depth and a node ID to view only that subtree, and SHALL show overlays closed unless asked to show them open.

#### Scenario: View a subtree
- **WHEN** the agent calls `design_view` with screen `orders` and node `filters` open
- **THEN** the result shows only the `filters` subtree, expanded, with one line per node

### Requirement: design_catalog
The `design_catalog` tool SHALL list kit components with one-line descriptions, and for a named component SHALL return its props with types, allowed values, defaults, and a minimal example. An unknown name SHALL return the closest component names.

#### Scenario: Component details
- **WHEN** the agent calls `design_catalog` with `Select`
- **THEN** the result lists every `Select` prop and a valid example snippet

### Requirement: Automatic validation after edits
After any tool call in a session with a design project, if files in the design folder changed during that call, the plugin SHALL attach to that call's result a validation summary of the changed files: error and warning counts and the first diagnostics up to a fixed cap. This SHALL apply whichever tool changed the files. When no design file changed, nothing SHALL be attached.

#### Scenario: Edit introduces an error
- **WHEN** the agent edits a screen file with the generic edit tool and leaves an unknown prop
- **THEN** the edit result includes the diagnostic for that prop

#### Scenario: Unrelated tool call
- **WHEN** the agent runs a shell command that changes no design file
- **THEN** its result has no design validation attached
