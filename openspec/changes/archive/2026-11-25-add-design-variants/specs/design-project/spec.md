# Spec Delta

## ADDED Requirements

### Requirement: Local discarded-variant records
New projects SHALL ignore design/.discarded/ as well as their generated cache. The documented promotion workflow for existing projects SHALL verify the discard directory is ignored before writing a record and update the design-level ignore file if it is not. Records SHALL be confined to the design folder, be excluded from discovery and handoff, and contain recoverable branch source plus a project-relative origin, screen, group, branch and UTC discard date. Explicit cleanup SHALL target only this discard location.

#### Scenario: Promote in a previously scaffolded project
- **WHEN** the owner promotes a branch in a Git project whose design ignore file only ignores the cache
- **THEN** the rejected source and its metadata are excluded from Git and absent from normal discovery and handoff
