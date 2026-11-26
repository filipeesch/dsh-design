# Spec Delta

## ADDED Requirements

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
