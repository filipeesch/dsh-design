# Spec Delta

## ADDED Requirements

### Requirement: Declarative variant groups
The DSL SHALL accept a Variants element with a stable group ID and a chosen branch ID, containing at least two Variant children with distinct branch IDs. A whole-screen branch SHALL contain one Screen rooted at the same screen identity; a subtree branch SHALL contain ordinary legal children for that position. Nested groups SHALL be addressable independently. Neither wrapper SHALL become a rendered element. Every branch SHALL be parsed and validated, including non-chosen branches. A stable node ID MAY repeat across mutually exclusive branches but SHALL remain unique in any single resolved screen. Invalid group structure, absent choices, conflicting IDs or unusable references SHALL produce source-located diagnostics without corrupting the last valid preview.

#### Scenario: Reuse an ID in mutually exclusive alternatives
- **WHEN** both branches define the same action ID in alternative presentations and no other visible component shares it
- **THEN** both branches validate and resolving one exposes exactly one node with that ID

#### Scenario: Unchosen branch is malformed
- **WHEN** an alternate contains a duplicate active node ID or a dangling local reference
- **THEN** validation identifies the invalid branch and source location even though it is not chosen
