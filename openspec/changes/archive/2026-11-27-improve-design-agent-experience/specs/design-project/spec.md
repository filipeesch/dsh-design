# design-project delta

## MODIFIED Requirements

### Requirement: Project config
The config file SHALL declare the pinned kit version and MAY declare named breakpoints (name to viewport width in CSS pixels) the entry screen, local stylesheet declarations, and named theme configuration. Missing optional fields SHALL fall back to documented defaults: breakpoints `mobile` 390, `tablet` 768, `desktop` 1280, and the first screen in alphabetical order as entry.

#### Scenario: Defaults applied
- **WHEN** the config declares only the kit version
- **THEN** the project uses the default breakpoints and the alphabetically first screen as entry

#### Scenario: Invalid config
- **WHEN** the config is not valid JSON or has a field of the wrong type
- **THEN** validation reports an error with the file and field, and the preview shows the error instead of rendering

### Requirement: Versioned sources and derived files
Only sources (config, tokens, layouts, screens, preview metadata, authored stylesheets, journeys, fixtures, and local design assets) SHALL be meant for version control. Files the plugin derives SHALL be written only to `.cache/` inside the design folder, which the scaffolded ignore file excludes from git.

#### Scenario: Derived output location
- **WHEN** the plugin writes any derived file
- **THEN** the file is inside `<design-folder>/.cache/`

### Requirement: Local discarded-variant records
New projects SHALL ignore design/.discarded/ as well as their generated cache. The documented promotion workflow for existing projects SHALL verify the discard directory is ignored before writing a record and update the design-level ignore file if it is not. Records SHALL be confined to the design folder, be excluded from active design source discovery, and contain recoverable branch source plus a project-relative origin, screen, group, branch and UTC discard date. Explicit cleanup SHALL target only this discard location.

#### Scenario: Promote in a previously scaffolded project
- **WHEN** the owner promotes a branch in a Git project whose design ignore file only ignores the cache
- **THEN** the rejected source and its metadata are excluded from Git and absent from normal design source discovery

## ADDED Requirements

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
