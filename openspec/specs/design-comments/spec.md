# design-comments Specification

## Purpose

Collect review comments on actual rendered components and deliberately send them together to the same DSH conversation without writing feedback to the design repository.

## Requirements

### Requirement: Anchored comment mode
The interactive preview SHALL let the owner enter comment mode, select a rendered component by pointer or keyboard, and write a comment anchored to that component. Selection SHALL NOT activate the underlying component while comment mode is active. A draft SHALL record the screen, breakpoint, component identity and type, and reproducible interaction context, including the named state if present and the active overlay and tab selections. It SHALL include variant identity when the renderer provides it. The preview SHALL identify structural addresses as unstable, omit secret fields and free-form entered values from the automatic context, and make comment text editable before sending.

#### Scenario: Pin a comment inside a drawer
- **WHEN** an owner enters comment mode at the mobile breakpoint with a drawer open and selects a visible component inside it
- **THEN** the draft and pin identify that component, screen, breakpoint and overlay context, without activating the component

#### Scenario: Anchor without a stable ID
- **WHEN** the owner comments on a component lacking an explicit or key-derived stable identity
- **THEN** the comment uses its structural address and is visibly marked as an unstable anchor

### Requirement: Pending drafts live outside the repository
The host SHALL keep bounded pending comments per DSH session outside the project repository. Drafts SHALL survive page reloads in the same running host; the owner SHALL be able to inspect, edit, and remove them before submission. After a layout change pins SHALL remain attached to matching stable components. Unresolved or stale anchors SHALL stay visible as pending without attaching silently to an unrelated component. Two sessions that share one project SHALL NOT share pending drafts.

#### Scenario: Reload and then change a target
- **WHEN** the owner reloads the preview and a subsequent design edit removes a commented component
- **THEN** the draft survives, is marked as unanchored after the edit, and remains editable or removable

#### Scenario: Sessions share files but not comments
- **WHEN** the owner opens the same project in two DSH sessions
- **THEN** comments created in one session do not appear in the other

### Requirement: Explicit batch submission
On the owner's explicit Send action, the system SHALL submit the reviewed pending comments as one ordinary user message to the same DSH conversation, with clear context for each comment. Sending SHALL NOT steer an active response. Drafts in the batch SHALL clear only after the session accepts the message. A rejected delivery SHALL keep the drafts and explain how to retry; retrying the same submission SHALL NOT enqueue another message when the first submission was already accepted. Drafts added after a batch starts SHALL NOT be cleared with that batch.

#### Scenario: Submit two comments as one message
- **WHEN** the owner sends two pending comments from the preview
- **THEN** exactly one user message contains both comments and their coordinates, and the successfully submitted drafts disappear

#### Scenario: Delivery rejected or acknowledgement lost
- **WHEN** the session rejects a batch, or the browser retries a batch that the session already accepted
- **THEN** rejected drafts remain editable, and retrying an already accepted batch returns its acknowledgement without sending it twice

### Requirement: Isolate review anchors between alternatives
In a comparison or explicit branch preview the review composer SHALL record the effective variant selection in the comment context and include it in the sent message. A draft SHALL NOT pin against a different branch just because both branches share the same node ID or address. The session pending queue SHALL retain drafts from other branches as reviewable entries.

#### Scenario: Comment on a shared ID in an alternate branch
- **WHEN** both comparison panes contain the same node ID and the owner comments in the unchosen pane
- **THEN** the pin appears only within that branch and the sent comment identifies it
