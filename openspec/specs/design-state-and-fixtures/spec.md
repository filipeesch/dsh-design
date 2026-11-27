# design-state-and-fixtures Specification

## Purpose

Give interactive previews deterministic starting points and realistic synthetic collections without coupling a sketch to the app or its data sources.

## Requirements

### Requirement: Named screen states
A screen SHALL accept named initial states that assign field values, select tabs, and open overlays by stable node ID. The unqualified screen SHALL keep its existing defaults. Unknown IDs, duplicate state names, incompatible values, and references to missing tabs SHALL produce source-located diagnostics. Selection SHALL initialize the preview; subsequent interaction and valid hot reloads SHALL preserve compatible live edits. A named state SHALL also support boolean expansion seeds for Disclosure instances by stable ID. Unknown or incompatible disclosure targets SHALL receive source-located diagnostics.

#### Scenario: Saved filter state
- **WHEN** an owner opens the orders screen in the named state `filter-open`
- **THEN** the declared drawer and field values are present and the owner can continue interacting

#### Scenario: Invalid initial assignment
- **WHEN** a state opens an ID which is not an overlay
- **THEN** validation identifies the invalid assignment and does not present it as a valid state

#### Scenario: Open a directly linked disclosure state
- **WHEN** a fresh preview opens a named state that expands one disclosure
- **THEN** that disclosure starts expanded without changing other disclosures or screen defaults, and the reviewer can collapse it

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

### Requirement: Temporary review render context
A measured inspection SHALL accept a bounded temporary interaction context over an authored state or the normal defaults for one current screen and projection. It SHALL support active tabs, the complete set of open overlays (including an explicitly empty set), and true or false Disclosure expansion by stable ID. It SHALL validate every supplied assignment against that projection, distinguish stale or incompatible coordinates from a valid render, and SHALL NOT replay old source, persist an authored state, or accept typed field or secret values as review coordinates.

#### Scenario: Restore an interaction that differs from its seed
- **WHEN** a named state starts with a drawer and disclosure open, but the submitted context records neither open and selects a different valid tab
- **THEN** the fresh measured render uses the temporary tab and closed controls and does not change the named state or the owner's preview

### Requirement: Authored seeds for added controls
Named states SHALL be able to seed a ToggleButton with a boolean and a SelectButton with a declared option value. Missing or incompatible targets and invalid option values SHALL produce source-located diagnostics rather than a substituted selection.

#### Scenario: Open a seeded segmented control
- **WHEN** a valid named state selects a declared segment and sets a ToggleButton pressed
- **THEN** both controls start in the requested states and remain independently interactive
