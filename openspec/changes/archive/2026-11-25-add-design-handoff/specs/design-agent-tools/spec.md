# Spec Delta

## ADDED Requirements

### Requirement: Design handoff tool contract
The Design preset SHALL expose design_handoff with structured status, project-relative artifact references, actionable diagnostics and a bounded summary. It SHALL use validated current chosen projections independently of the transient preview and without requiring an external application. Other presets SHALL NOT gain the tool by default; their agents can read the package through authorized standard tools.

#### Scenario: Use a handoff from a coding session
- **WHEN** the design agent generates a package and shares its project-relative manifest path with the implementing agent
- **THEN** the implementing agent can read the contract using normal file access without changing presets
