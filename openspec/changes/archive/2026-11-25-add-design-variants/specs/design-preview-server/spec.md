# Spec Delta

## ADDED Requirements

### Requirement: Variant-aware preview routes
The interactive preview SHALL support shareable variant and comparison selections tied to the selected screen and group. Changing the shared breakpoint or named state SHALL apply the same starting selection to both comparison panes. Unknown IDs and incompatible named-state targets SHALL be diagnosed instead of silently substituting the chosen branch or a different state. The routes SHALL retain owner admission, live-reload and last-valid behavior, and the deterministic route SHALL remain a self-contained single-canvas document.

#### Scenario: Refresh a comparison link
- **WHEN** an authorized owner reloads a comparison URL for two alternatives at a named state and breakpoint
- **THEN** the same branches render at that breakpoint and state, or an explicit diagnostic explains any incompatible side
