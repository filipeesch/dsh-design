# Spec Delta

## ADDED Requirements

### Requirement: Named-state deep links
Selecting an existing state with `?state=<id>` SHALL apply that state on its screen, including on direct load and history navigation, without leaking state across sessions or applying assignments for other screens. An unknown state SHALL receive a clear diagnostic instead of silently falling back. Named states SHALL work in both interactive and deterministic previews.

#### Scenario: Open a saved mobile state
- **WHEN** the owner opens `/design/<session-id>/orders?bp=mobile&state=filter-open`
- **THEN** the orders screen loads at the mobile width with the named drawer state applied

#### Scenario: State cannot be resolved
- **WHEN** the state query names no state on the selected screen
- **THEN** the preview shows an explicit state diagnostic and does not pretend the state was applied
