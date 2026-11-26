# Spec Delta

## MODIFIED Requirements

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
