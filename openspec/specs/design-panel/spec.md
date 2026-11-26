# design-panel Specification

## Purpose

Put the existing interactive design preview beside its DSH conversation so the owner can review a design without leaving the active session.

## Requirements

### Requirement: Session-bound Design panel
The external plugin SHALL offer a Design panel in the DSH Web GUI for the displayed session. Opening it SHALL show that session's owner-authenticated interactive preview alongside the conversation when space permits. Switching sessions SHALL NOT keep displaying another session's design. The panel SHALL offer a separate-tab link for the same session and a useful missing-project state with the next step.

#### Scenario: Open the panel alongside chat
- **WHEN** the owner opens Design from an existing session with a project on a wide viewport
- **THEN** the interactive preview and the session conversation are visible at the same time

#### Scenario: Switch sessions or recover from missing project
- **WHEN** the owner switches to another session or opens the panel for a session without design files
- **THEN** the former preview is not shown as the new session's design and the new session shows its own preview or the setup guidance

### Requirement: Responsive panel controls
The panel SHALL work within the host's layout, including narrow viewports. The owner SHALL be able to open and close the panel and return to the conversation; the preview's breakpoint controls, internal scrolling, and comment composer SHALL remain usable without forcing page-wide horizontal overflow.

#### Scenario: Review on a phone
- **WHEN** the owner opens Design at a 390 CSS pixel viewport
- **THEN** the owner can use the preview and comment controls and return to the conversation without page-wide horizontal overflow

### Requirement: Contextual navigation in constrained space
Embedded and narrow previews SHALL provide access to the same screen and situation navigation, context, map, and applicable simulation actions using collapsible or on-demand controls. Review chrome SHALL NOT change the selected canvas breakpoint or replace existing comment and preview recovery behavior. Navigation surfaces SHALL be keyboard-operable and restore usable focus when closed.

#### Scenario: Navigate a wide design beside chat
- **WHEN** a reviewer opens the screen navigator in a narrow Design panel while inspecting a desktop breakpoint
- **THEN** the reviewer can select another situation and dismiss the navigator without the canvas switching to a different design breakpoint or losing access to review comments
