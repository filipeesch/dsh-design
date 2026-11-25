# Spec Delta

## ADDED Requirements

### Requirement: Isolate review anchors between alternatives
In a comparison or explicit branch preview the review composer SHALL record the effective variant selection in the comment context and include it in the sent message. A draft SHALL NOT pin against a different branch just because both branches share the same node ID or address. The session pending queue SHALL retain drafts from other branches as reviewable entries.

#### Scenario: Comment on a shared ID in an alternate branch
- **WHEN** both comparison panes contain the same node ID and the owner comments in the unchosen pane
- **THEN** the pin appears only within that branch and the sent comment identifies it
