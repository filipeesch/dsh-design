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

### Requirement: Component-anchored comment composer
When the owner selects a component in comment mode from a desktop browser, the interactive preview SHALL open a comment balloon beside that component, not at a fixed footer location. The balloon SHALL visibly point to its target, fit within the visible preview pane, and stay aligned when the target moves or the pane scrolls or resizes. Placement SHALL NOT change the design canvas geometry. This interaction SHALL work at the Mobile preview breakpoint on a desktop browser as well as at desktop breakpoints.

#### Scenario: Comment next to a component in a Mobile preview on a PC
- **WHEN** the owner uses a desktop browser, selects the Mobile breakpoint, and clicks a visible control inside an open drawer in comment mode
- **THEN** a focused comment balloon appears next to that control without activating it or closing the drawer

#### Scenario: Place a balloon near a pane edge
- **WHEN** the target is near the edge of the preview pane or the pane is resized or scrolled
- **THEN** the balloon chooses an available side or shifts within the pane and continues to point to the same component while it is visible

### Requirement: Reopen comments at their anchors
Saving a comment SHALL close the balloon and leave its pin. Activating a pin by pointer or keyboard SHALL reopen the editor at the same component. Closing or saving SHALL restore focus to an appropriate origin without triggering the target control. If the component cannot be safely resolved, the preview SHALL NOT show a balloon pointing to a different element. A saved comment with an unavailable anchor SHALL remain editable from Pending. Pending review and deliberate batch submission SHALL retain their existing behavior.

#### Scenario: Save and reopen a comment
- **WHEN** the owner saves a new comment and then activates the remaining pin
- **THEN** the saved text is editable in a balloon at the original component, and Escape closes the balloon without activating underlying controls

#### Scenario: An anchor is no longer available
- **WHEN** a saved draft belongs to another screen or variant, or its component was removed
- **THEN** the owner can still edit it in Pending without a balloon attached to an unrelated component
