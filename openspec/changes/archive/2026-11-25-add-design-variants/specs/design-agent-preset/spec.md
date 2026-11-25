# Spec Delta

## ADDED Requirements

### Requirement: Variant exploration and source promotion guidance
The preset SHALL show the agent how to author alternatives in the DSL, share and compare their preview, inspect them with design_diff, and promote the owner-selected winner by direct source edits. It SHALL instruct the agent to preserve ignored local discard records before the edit, verify the normal chosen projection after it, and clean records only on explicit owner request.

#### Scenario: Explore without changing the chosen design
- **WHEN** the agent is asked to try a new alternative
- **THEN** the guidance tells it to keep the current choice while preparing the comparison and wait for an explicit selection before promotion
