# Spec Delta

## ADDED Requirements

### Requirement: Authenticated panel embedding and comment mutations
The interactive preview SHALL support embedding by the owning DSH GUI on the same origin. Comment reads and mutations SHALL be owner-only and scoped to the session in the preview URL. Mutations SHALL require a deliberate same-origin request with bounded, validated input; they SHALL NOT be triggered by navigation, inline project content, or a background design check. The deterministic preview SHALL remain free of comment UI and comment network requests.

#### Scenario: Standalone and embedded share pending drafts
- **WHEN** the owner views the same session in the Design panel and a separate tab
- **THEN** both clients can read that session's pending drafts through the same authenticated service

#### Scenario: Deterministic preview is unchanged
- **WHEN** the owner opens a deterministic preview or an agent runs a browser-backed check
- **THEN** no comment controls or drafts are rendered and no comment request is made
