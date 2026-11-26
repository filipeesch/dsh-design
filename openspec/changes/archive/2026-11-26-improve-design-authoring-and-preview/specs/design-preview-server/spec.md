# Spec Delta

## ADDED Requirements

### Requirement: Screen-first contextual navigation
The interactive preview SHALL open the requested screen or existing entry, not the map. It SHALL offer a screen sidebar with human-readable labels, active and entry indications, optional grouping, and authored situations nested under their parent screen. Visual alternatives SHALL remain in a separate selector. It SHALL show a per-screen summary when authored and expose durable details on demand outside the canvas. A situation link SHALL restore its authored screen and optional named state on a fresh load; subsequent local interaction SHALL NOT change the authored link or source. Review chrome SHALL NOT appear in deterministic canvas output.

#### Scenario: Review an authored situation directly
- **WHEN** a reviewer opens a link to the checkout situation with price details expanded
- **THEN** the selected situation is identifiable in the sidebar, the authored disclosure starts expanded, and the reviewer can collapse it without changing the link

#### Scenario: Legacy project without descriptions
- **WHEN** a reviewer opens an existing project that has no authored metadata
- **THEN** the entry opens normally, the sidebar lists its screens by title or ID fallback, and no empty description panel is forced onto the canvas

### Requirement: On-demand clickable design map
The preview SHALL expose an optional map that initially centers on the active screen and its immediate incoming and outgoing connections and can switch to all screens, including disconnected screens. Map destinations SHALL be directly openable by pointer and keyboard. The map SHALL derive prototype navigation from resolved design actions and combine it with explicitly authored relationships; it SHALL distinguish prototype links, simulated responses, and illustrative-only relationships with text as well as visual treatment. Tab changes, overlays, and inline disclosures SHALL NOT be separate edges simply because their internal state changes. A visual alternative SHALL NOT contribute phantom links to another projection. No separately maintained path list or journey SHALL be required.

#### Scenario: Inspect nearby and unrelated flows
- **WHEN** a reviewer opens the map from a screen with neighbors in a project that also has a disconnected flow
- **THEN** nearby connections appear first and the reviewer can switch to the full map and open a disconnected screen

#### Scenario: Change the target in the design
- **WHEN** a valid edit changes a button's declared navigation target
- **THEN** the map updates the corresponding prototype edge without an additional metadata edit and never presents an illustrative-only edge as an action inside the canvas

### Requirement: Manually simulate authored outcomes outside the canvas
The interactive preview SHALL offer named controls outside the canvas for valid simulated relationships from the current authored selection. Each control SHALL open only its predefined local destination. A single authored outcome SHALL be directly actionable; multiple authored outcomes SHALL be distinct explicit choices. Rendering, opening the map, or revisiting a situation SHALL NOT trigger an outcome. No timers, real services, inferred rules, or business side effects SHALL be used. Comment selection SHALL continue to avoid activating the underlying prototype control.

#### Scenario: Choose one of two fictitious system outcomes
- **WHEN** a reviewer reaches a document review situation and chooses Simulate correction request rather than Simulate approval
- **THEN** the predefined correction situation opens; neither outcome runs without explicit selection and the canvas contains no extra simulation control
