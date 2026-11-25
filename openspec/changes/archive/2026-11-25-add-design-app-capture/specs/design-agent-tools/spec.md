# Spec Delta

## ADDED Requirements

### Requirement: Live app capture release gate

The production plugin SHALL NOT include a live app capture runtime or expose live app capture tooling or guidance until independent end-to-end testing of the exact installed package on an owner-approved runtime verifies a successful capture with both OS-enforced browser network isolation and Chromium sandboxing intact. Local design previews and implementation handoff SHALL remain independent of live app capture.

#### Scenario: Release without verified live app capture

- **WHEN** the production bundle has no verified live app capture runtime
- **THEN** the bundle contains no live app capture worker or service, neither Design nor Standard exposes a live app capture tool, and local preview and implementation handoff remain available without that runtime
