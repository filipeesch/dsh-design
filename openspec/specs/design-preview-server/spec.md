# design-preview-server Specification

## Purpose

Defines the browser preview of a session's design on the DSH web server: its URL, who can open it, how several sessions coexist, and how it follows file changes instantly.

## Requirements

### Requirement: Per-session preview URL
The DSH web server SHALL serve the design project of a session at `/design/<session-id>/`. A path segment after it SHALL select a screen by ID, and the `bp` query parameter SHALL select a breakpoint by name. Without them the entry screen and the widest breakpoint SHALL be shown.

#### Scenario: Open a screen at a breakpoint
- **WHEN** the owner opens `/design/<session-id>/orders?bp=mobile`
- **THEN** the `orders` screen renders inside a frame of the mobile width

#### Scenario: Unknown session or screen
- **WHEN** the session ID or the screen ID does not exist
- **THEN** the server responds with a not-found page that lists the available screens when the session exists

### Requirement: Owner-only access
Preview requests SHALL require the same owner credential as the DSH web GUI. Requests without it MUST be refused, and the preview MUST NOT be served anonymously.

#### Scenario: Unauthenticated request
- **WHEN** a request without the DSH owner credential reaches `/design/<session-id>/`
- **THEN** it is refused and no design content is returned

### Requirement: Parallel sessions
The server SHALL serve the previews of several sessions at the same time, each bound to its own session's design project.

#### Scenario: Two sessions
- **WHEN** two sessions in different repositories each have a design project
- **THEN** both preview URLs work simultaneously and each shows its own project

### Requirement: Live reload without a build step
Any change to a file in the design folder SHALL be reflected in every open preview of that project within one second, without a build or a manual refresh.

#### Scenario: Edit a screen
- **WHEN** a screen file is saved with a new button
- **THEN** open previews of that screen show the button within one second

### Requirement: State preserved across reloads
On live reload the preview SHALL keep the current screen, breakpoint, open overlays, active tabs, and entered values for every node whose ID still exists, and SHALL drop state for nodes that no longer exist.

#### Scenario: Drawer stays open
- **WHEN** the drawer `filters` is open and its title text is edited
- **THEN** after the reload the drawer is still open and shows the new title

#### Scenario: Removed node
- **WHEN** the open drawer is deleted from the file
- **THEN** after the reload the screen renders without it and without an error

### Requirement: Invalid design display
When the project has validation errors, the preview SHALL keep showing the last valid render and SHALL overlay the current errors with file, line, and message. The overlay SHALL disappear on the first valid reload.

#### Scenario: Syntax error while editing
- **WHEN** a save introduces an unclosed tag
- **THEN** the previous render stays visible with an error overlay pointing at the file and line

### Requirement: No external resources
The preview page SHALL load resources only from the DSH web server.

#### Scenario: Offline preview
- **WHEN** the machine has no internet access
- **THEN** the preview renders completely
