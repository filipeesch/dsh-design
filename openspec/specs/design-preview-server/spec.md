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

### Requirement: Named-state deep links
Selecting an existing state with `?state=<id>` SHALL apply that state on its screen, including on direct load and history navigation, without leaking state across sessions or applying assignments for other screens. An unknown state SHALL receive a clear diagnostic instead of silently falling back. Named states SHALL work in both interactive and deterministic previews.

#### Scenario: Open a saved mobile state
- **WHEN** the owner opens `/design/<session-id>/orders?bp=mobile&state=filter-open`
- **THEN** the orders screen loads at the mobile width with the named drawer state applied

#### Scenario: State cannot be resolved
- **WHEN** the state query names no state on the selected screen
- **THEN** the preview shows an explicit state diagnostic and does not pretend the state was applied

### Requirement: Authenticated panel embedding and comment mutations
The interactive preview SHALL support embedding by the owning DSH GUI on the same origin. Comment reads and mutations SHALL be owner-only and scoped to the session in the preview URL. Mutations SHALL require a deliberate same-origin request with bounded, validated input; they SHALL NOT be triggered by navigation, inline project content, or a background design check. The deterministic preview SHALL remain free of comment UI and comment network requests.

#### Scenario: Standalone and embedded share pending drafts
- **WHEN** the owner views the same session in the Design panel and a separate tab
- **THEN** both clients can read that session's pending drafts through the same authenticated service

#### Scenario: Deterministic preview is unchanged
- **WHEN** the owner opens a deterministic preview or an agent runs a browser-backed check
- **THEN** no comment controls or drafts are rendered and no comment request is made

### Requirement: Variant-aware preview routes
The interactive preview SHALL support shareable variant and comparison selections tied to the selected screen and group. Changing the shared breakpoint or named state SHALL apply the same starting selection to both comparison panes. Unknown IDs and incompatible named-state targets SHALL be diagnosed instead of silently substituting the chosen branch or a different state. The routes SHALL retain owner admission, live-reload and last-valid behavior, and the deterministic route SHALL remain a self-contained single-canvas document.

#### Scenario: Refresh a comparison link
- **WHEN** an authorized owner reloads a comparison URL for two alternatives at a named state and breakpoint
- **THEN** the same branches render at that breakpoint and state, or an explicit diagnostic explains any incompatible side

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
