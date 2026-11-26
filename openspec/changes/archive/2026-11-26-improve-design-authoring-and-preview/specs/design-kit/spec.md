# Spec Delta

## ADDED Requirements

### Requirement: Semantic presentation options
The kit SHALL offer opt-in compact tab presentation and compact icon controls using declared or token-backed styling while preserving existing defaults. Styling SHALL NOT change selected state, accessible names, keyboard operation, or semantic roles.

#### Scenario: Restyle tabs without substituting navigation
- **WHEN** a reviewer selects a compact tab with the keyboard
- **THEN** the tab retains its semantic role and switches its panel in place

### Requirement: Inline disclosure
The kit SHALL offer an addressable Disclosure with a labeled toggle and an accessible expanded state. It SHALL reveal and hide its own child content in place, support an authored initial open or closed value, retain focus on activation, and keep instances independent. Collapsed content SHALL not be visible or keyboard-focusable. Disclosure SHALL NOT imply navigation or change the visibility of arbitrary other nodes.

#### Scenario: Expand one item among several
- **WHEN** a keyboard reviewer expands and collapses one FAQ answer
- **THEN** only that answer changes visibility, the expanded indicator updates, and focus remains usable
