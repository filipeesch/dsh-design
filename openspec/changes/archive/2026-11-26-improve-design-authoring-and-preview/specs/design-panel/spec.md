# Spec Delta

## ADDED Requirements

### Requirement: Contextual navigation in constrained space
Embedded and narrow previews SHALL provide access to the same screen and situation navigation, context, map, and applicable simulation actions using collapsible or on-demand controls. Review chrome SHALL NOT change the selected canvas breakpoint or replace existing comment and preview recovery behavior. Navigation surfaces SHALL be keyboard-operable and restore usable focus when closed.

#### Scenario: Navigate a wide design beside chat
- **WHEN** a reviewer opens the screen navigator in a narrow Design panel while inspecting a desktop breakpoint
- **THEN** the reviewer can select another situation and dismiss the navigator without the canvas switching to a different design breakpoint or losing access to review comments
