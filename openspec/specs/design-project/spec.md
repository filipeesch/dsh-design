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
The config file SHALL declare the pinned kit version and MAY declare named breakpoints (name to viewport width in CSS pixels) and the entry screen. Missing optional fields SHALL fall back to documented defaults: breakpoints `mobile` 390, `tablet` 768, `desktop` 1280, and the first screen in alphabetical order as entry.

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
Only sources (config, tokens, screens, and later journeys and fixtures) SHALL be meant for version control. Files the plugin derives SHALL be written only to `.cache/` inside the design folder, which the scaffolded ignore file excludes from git.

#### Scenario: Derived output location
- **WHEN** the plugin writes any derived file
- **THEN** the file is inside `<design-folder>/.cache/`

### Requirement: Writes confined to the design folder
Files the plugin itself writes into the target repository SHALL be inside the design folder.

#### Scenario: No writes outside the design folder
- **WHEN** any plugin operation completes
- **THEN** no file outside the design folder was created or modified by the plugin
