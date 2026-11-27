# design-dsl delta

## ADDED Requirements

### Requirement: Shared layout composition
A screen SHALL be able to select one project-local named DSX layout containing shared nodes and exactly one content slot. The slot SHALL receive that screen's ordinary children. Layouts SHALL NOT accept parameters, nested layout references, multiple slots, imports, or executable expressions. Composition SHALL preserve screen-local identities and source locations; duplicate resolved IDs and invalid references SHALL be diagnosed, never silently renamed. Existing screens without a layout SHALL remain valid.

#### Scenario: Share navigation without copying the screen body
- **WHEN** two screens select the same layout containing a navigation control and supply different content
- **THEN** both resolved screens contain the shared control at its stable ID and only their own body, with no layout or slot wrapper rendered

#### Scenario: Reject invalid composition
- **WHEN** a layout is missing, contains two slots, or introduces a collision with the consuming screen
- **THEN** validation locates the layout declaration or use and the affected screen, without selecting a different layout or changing either ID

### Requirement: Explicit stylesheet class references
Nodes SHALL be able to opt in to authored stylesheet classes by literal names. Classes SHALL refer only to declared local stylesheet rules and affect only the component root to which they are applied. Existing node-scoped CSS SHALL remain available and override class styling for the same supported property.

#### Scenario: Apply a shared class locally
- **WHEN** one node references a declared class and a sibling does not
- **THEN** only the opted-in root receives the class declarations, and an unknown class is reported at the authored reference
