# design-variants Specification

## Purpose

Let owners explore alternative screens and component arrangements in a single design project, compare them interactively, and keep only the selected design in the final source.

## Requirements

### Requirement: Chosen variant projection
A design MAY declare a group of alternatives for a whole screen or subtree. Every group SHALL identify exactly one chosen branch in source. The normal preview and reproducible handoff input SHALL contain only the chosen branches. Reading or comparing an alternative SHALL NOT change the chosen source.

#### Scenario: Open a screen with two alternatives
- **WHEN** a screen has a compact branch and a spacious branch with compact chosen
- **THEN** opening the normal preview or resolving the handoff input renders compact only

### Requirement: Interactive side-by-side comparison
The owner SHALL be able to compare two branches of a selected group at the same screen, breakpoint and starting state. Each pane SHALL identify the branch and whether it is chosen, retain the actual breakpoint width, and allow independent interaction, focus and navigation. On a narrow host viewport the comparison SHALL remain side by side with internal horizontal scrolling, not force the host page to overflow or scale one branch differently.

#### Scenario: Interact with one branch of a mobile comparison
- **WHEN** the owner opens a drawer or edits a field in one pane of a mobile comparison
- **THEN** only that pane changes and both panes still render at the same selected breakpoint

### Requirement: Promote and discard through source edits
After the owner selects a winner, the design workflow SHALL let the agent preserve the rejected alternatives as local records with their origin and discard date, then replace the selected Variants block in the source with the winning contents using ordinary text tools. A choice change alone SHALL NOT discard or promote content. The workflow SHALL explain how to clear the local records explicitly when exploration ends, without deleting other project files.

#### Scenario: Promote one subtree and clean up
- **WHEN** the owner asks to promote a winning subtree and later asks to clean discarded alternatives
- **THEN** the winner replaces the group, rejected branches are recoverable locally until cleanup, and cleanup leaves all live design sources intact
