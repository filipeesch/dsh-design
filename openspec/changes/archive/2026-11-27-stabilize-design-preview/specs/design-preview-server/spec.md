# Spec Delta

## ADDED Requirements

### Requirement: Concurrent previews leave DSH requests responsive
Live update traffic from Design previews SHALL NOT monopolize the browser's ordinary HTTP connections to the DSH origin. The panel, standalone previews, and comparison views SHALL continue to work on the supported DSH HTTP/1.1 deployment without requiring a server configuration change.

#### Scenario: Six preview documents on one DSH origin
- **WHEN** at least six interactive preview documents, including the Design panel and a standalone tab, remain open in one Chromium browser context on the same HTTP/1.1 DSH origin with the agent idle
- **THEN** a same-origin DSH request completes while all previews remain open, without closing a preview or waiting for a design edit

### Requirement: Smaller initial transfer for standalone preview
Opening the standalone preview SHALL transfer less preview data before the initial canvas is displayed than the previous complete-project response on the same representative 30-screen project. The preview SHALL NOT eagerly transfer render trees for unselected screens. Screen labels, groups, situations, and map destinations SHALL remain available, and navigating to another screen SHALL render its selected design without a browser reload.

#### Scenario: Open a standalone tab while the panel remains open
- **WHEN** the owner opens the standalone preview from the panel of a 30-screen project
- **THEN** the initial preview data transfer is smaller than the baseline for the same sources, URL, and browser cache conditions, and the selected canvas and existing navigation are usable

## MODIFIED Requirements

### Requirement: Live reload without a build step
Any change to a file in the design folder SHALL be reflected in every open preview of that project within one second while its document is running normally on the local host, without a build or a manual refresh. A preview whose execution the browser suspends or throttles SHALL automatically catch up when it becomes active again. Unchanged sources SHALL NOT cause periodic downloads of the render payload.

#### Scenario: Edit a screen
- **WHEN** a screen file is saved with a new button
- **THEN** open previews of that screen show the button within one second while their documents are running normally

#### Scenario: Return to a suspended preview
- **WHEN** a project is edited while an open standalone preview is suspended or throttled by the browser and the owner returns to that preview
- **THEN** it displays the latest revision without a manual reload, retaining compatible interaction state
