# design-variants delta

## MODIFIED Requirements

### Requirement: Chosen variant projection
A design MAY declare a group of alternatives for a whole screen or subtree. Every group SHALL identify exactly one chosen branch in source. The normal preview and default inspection projection SHALL contain only the chosen branches. Reading or comparing an alternative SHALL NOT change the chosen source.

#### Scenario: Open a screen with two alternatives
- **WHEN** a screen has a compact branch and a spacious branch with compact chosen
- **THEN** opening the normal preview or resolving the default inspection projection renders compact only

### Requirement: Interactive side-by-side comparison
The owner SHALL be able to compare two branches of a selected group at the same screen, breakpoint, starting state, and theme. Each pane SHALL identify the branch and whether it is chosen, retain the actual breakpoint width, and allow independent interaction, focus and navigation. On a narrow host viewport the comparison SHALL remain side by side with internal horizontal scrolling, not force the host page to overflow or scale one branch differently.

#### Scenario: Interact with one branch of a mobile comparison
- **WHEN** the owner opens a drawer or edits a field in one pane of a mobile comparison
- **THEN** only that pane changes and both panes still render at the same selected breakpoint
