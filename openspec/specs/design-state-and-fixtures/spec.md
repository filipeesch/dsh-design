# design-state-and-fixtures Specification

## Purpose

Give interactive previews deterministic starting points and realistic synthetic collections without coupling a sketch to the app or its data sources.

## Requirements

### Requirement: Named screen states
A screen SHALL accept named initial states that assign field values, select tabs, and open overlays by stable node ID. The unqualified screen SHALL keep its existing defaults. Unknown IDs, duplicate state names, incompatible values, and references to missing tabs SHALL produce source-located diagnostics. Selection SHALL initialize the preview; subsequent interaction and valid hot reloads SHALL preserve compatible live edits.

#### Scenario: Saved filter state
- **WHEN** an owner opens the orders screen in the named state `filter-open`
- **THEN** the declared drawer and field values are present and the owner can continue interacting

#### Scenario: Invalid initial assignment
- **WHEN** a state opens an ID which is not an overlay
- **THEN** validation identifies the invalid assignment and does not present it as a valid state

### Requirement: Project-local fixture data
Designs SHALL load bounded JSON fixtures from the design folder's optional `fixtures/` directory. The format SHALL require stable, unique item keys for templates and support only declarative value lookup. File-backed data outside the design folder, network requests, code execution, and live app data connections SHALL NOT be used. Documentation and examples SHALL use fictitious data.

#### Scenario: Missing fixture
- **WHEN** a screen refers to a nonexistent fixture or invalid collection field
- **THEN** validation reports the source file, position, and missing or incompatible reference

### Requirement: Collection rendering
Lists SHALL support a declarative item template using scalar fixture fields. Tables and selects SHALL support fixture rows and option values through declarative bindings. Reordering items SHALL retain the expanded nodes' identities by key; an empty fixture collection SHALL render no items. Existing inline list, table and option content SHALL still work.

#### Scenario: Same fixture drives preview and checks
- **WHEN** a screen uses a fixture-backed list, table, and select
- **THEN** the owner sees the same rows and choices in interactive preview and in deterministic checks

#### Scenario: Stable expansion
- **WHEN** valid fixture rows are reordered
- **THEN** each addressable repeated item keeps its stable key-derived identity and moves to the new position
