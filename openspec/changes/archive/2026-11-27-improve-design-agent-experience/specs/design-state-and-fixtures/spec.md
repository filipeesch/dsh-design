# design-state-and-fixtures delta

## ADDED Requirements

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
