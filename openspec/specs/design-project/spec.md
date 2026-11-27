# design-project Specification

## Purpose

Defines where a design lives inside the target app repository, which files make it up, how the plugin finds it from a session, and which files are versioned versus derived.

## Requirements

### Requirement: Design folder discovery
A design project SHALL be identified by a config file named `design.json` inside a design folder. The design folder SHALL default to `design/` at the session's working directory and SHALL be configurable per plugin installation.

#### Scenario: Project found
- **WHEN** a session's working directory contains `design/design.json`
- **THEN** the design tools and the session's preview operate on that folder

#### Scenario: Project absent
- **WHEN** a session's working directory has no design config file in the configured folder
- **THEN** the design tools report that no design project exists and point to the scaffolding tool, without raising an internal error

### Requirement: Project config
The config file SHALL declare the pinned kit version and MAY declare named breakpoints (name to viewport width in CSS pixels) the entry screen, local stylesheet declarations, and named theme configuration. Missing optional fields SHALL fall back to documented defaults: breakpoints `mobile` 390, `tablet` 768, `desktop` 1280, and the first screen in alphabetical order as entry.

#### Scenario: Defaults applied
- **WHEN** the config declares only the kit version
- **THEN** the project uses the default breakpoints and the alphabetically first screen as entry

#### Scenario: Invalid config
- **WHEN** the config is not valid JSON or has a field of the wrong type
- **THEN** validation reports an error with the file and field, and the preview shows the error instead of rendering

### Requirement: Design tokens file
The project SHALL keep its design tokens in `tokens.json` inside the design folder, using the W3C Design Tokens Community Group format (`$value`, `$type`, nested groups, and `{group.token}` aliases). Tokens SHALL be addressable from the DSL by their dotted path.

#### Scenario: Token alias resolved
- **WHEN** `color.action` has the value `{color.blue.600}` and a component uses `color.action`
- **THEN** the component renders with the value of `color.blue.600`

#### Scenario: Broken alias
- **WHEN** a token aliases a path that does not exist
- **THEN** validation reports an error naming the token and the missing path

### Requirement: Screens as files
Each screen SHALL live in its own `.dsx` file under `screens/` in the design folder, and screen IDs SHALL be unique across the project.

#### Scenario: Duplicate screen ID
- **WHEN** two screen files declare the same screen ID
- **THEN** validation reports an error listing both files

### Requirement: Scaffolding
The plugin SHALL scaffold a new design project with a config file, a default token set, one sample screen, and an ignore file for derived files, and SHALL refuse to scaffold over an existing project.

#### Scenario: Scaffold a new project
- **WHEN** scaffolding runs in a working directory without a design project
- **THEN** the design folder is created with `design.json`, `tokens.json`, `screens/` containing one valid sample screen, and `.gitignore` ignoring the cache folder

#### Scenario: Existing project
- **WHEN** scaffolding runs where `design.json` already exists
- **THEN** nothing is written and the result says the project already exists

### Requirement: Versioned sources and derived files
Only sources (config, tokens, layouts, screens, preview metadata, authored stylesheets, journeys, fixtures, and local design assets) SHALL be meant for version control. Files the plugin derives SHALL be written only to `.cache/` inside the design folder, which the scaffolded ignore file excludes from git.

#### Scenario: Derived output location
- **WHEN** the plugin writes any derived file
- **THEN** the file is inside `<design-folder>/.cache/`

### Requirement: Writes confined to the design folder
Files the plugin itself writes into the target repository SHALL be inside the design folder.

#### Scenario: No writes outside the design folder
- **WHEN** any plugin operation completes
- **THEN** no file outside the design folder was created or modified by the plugin

### Requirement: Local discarded-variant records
New projects SHALL ignore design/.discarded/ as well as their generated cache. The documented promotion workflow for existing projects SHALL verify the discard directory is ignored before writing a record and update the design-level ignore file if it is not. Records SHALL be confined to the design folder, be excluded from active design source discovery, and contain recoverable branch source plus a project-relative origin, screen, group, branch and UTC discard date. Explicit cleanup SHALL target only this discard location.

#### Scenario: Promote in a previously scaffolded project
- **WHEN** the owner promotes a branch in a Git project whose design ignore file only ignores the cache
- **THEN** the rejected source and its metadata are excluded from Git and absent from normal design source discovery

### Requirement: Versioned preview context and relationships
The project SHALL support optional local, versioned preview metadata keyed by stable identifiers. It SHALL describe screen purpose and durable details, ordered screen grouping and situations, and explicitly authored illustrative or simulated relationships. A situation SHALL reference an existing screen and optionally a valid named initial state; it SHALL NOT be a visual variant or saved viewer state. A simulated relationship SHALL name a fictitious outcome and reference valid local source and destination selections. Metadata SHALL NOT accept executable code, external destinations, or session review content.

#### Scenario: Open a project with no metadata
- **WHEN** an existing project contains only the existing required source files
- **THEN** it previews normally with inferred screen labels and derived connections where available, without requiring a migration

#### Scenario: Recover from a dangling reference
- **WHEN** a situation or relationship refers to a removed screen or state
- **THEN** an actionable source-located diagnostic identifies the reference, the invalid entry cannot be invoked, and unrelated valid screens remain reviewable

#### Scenario: Edit durable context
- **WHEN** an author updates a valid screen summary in the project metadata
- **THEN** live preview presents the updated summary without changing the canvas or requiring a rebuild

### Requirement: Local shared layout sources
A project SHALL discover optional named `.dsx` layouts in its local layout directory. Names SHALL resolve uniquely within that project. Missing, malformed, or conflicting layout input SHALL produce source-located diagnostics for affected screens, without introducing another project's sources.

#### Scenario: Revalidate a shared layout
- **WHEN** a layout used by multiple screens changes
- **THEN** all consuming screens are revalidated and report their relevant diagnostics, while unrelated screen projections remain usable

### Requirement: Named token palettes
The project SHALL allow optional local named palettes to override typed base tokens, including a light and a dark palette authored without screen duplication. Overrides SHALL retain token types and resolve aliases within the effective palette. An unspecified default SHALL use the base palette; systems SHALL NOT derive a theme from time, OS settings, or session identity. Missing, unknown, cyclic, or incompatible palette declarations SHALL be diagnosed at the source.

#### Scenario: Keep an existing design unchanged
- **WHEN** a project declares neither named themes nor new input files
- **THEN** it uses the same base tokens and its default canvas renders without a migration

### Requirement: Restricted local stylesheets
The project SHALL allow only explicitly declared local stylesheet files. Each rule SHALL target a single simple author class and use supported bounded declarations; other selectors, selector lists, at-rules, imports, URLs, and authored !important SHALL be rejected. Stylesheet application SHALL be deterministic and confined to explicitly opted-in canvas roots; invalid declarations SHALL NOT be forwarded to browsers. Files outside the design folder SHALL NOT be loaded.

#### Scenario: Reject a rule that does not target an opted-in root
- **WHEN** a declared file contains a descendant selector, a viewport rule, or an external resource reference
- **THEN** validation identifies its source and the invalid input has no effect on the preview or checks
