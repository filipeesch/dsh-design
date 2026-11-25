# Spec Delta

## ADDED Requirements

### Requirement: Read-only semantic design diff
The design_diff tool SHALL compare two branch selections of the same screen or the chosen projections of that screen at two locally available Git revisions. It SHALL report deterministic additions, removals, moves, and changes to node type, props or text using stable IDs where available. Structural fallback SHALL be labeled; uncertain moves SHALL NOT be claimed as stable matches. Invalid selections, unavailable revisions and absent screens SHALL return actionable diagnostics. The tool SHALL NOT check out revisions, write project files, fetch remote history, or require Chromium.

#### Scenario: Compare reordered branches
- **WHEN** an owner compares two valid alternatives with the same stable button ID moved into another container and given a new label
- **THEN** design_diff identifies the move and label change without reporting the stable node as removed and added

#### Scenario: Compare two Git revisions without a checkout
- **WHEN** the agent requests a comparison of the screen at two available revisions while the worktree has uncommitted edits
- **THEN** the result uses the selected local revisions and the uncommitted edits and checkout remain unchanged

### Requirement: Variant-aware design inspection
Design status and validation SHALL surface variant groups, choices and branch diagnostics. Screen inspection, queries and screenshots SHALL use the chosen projection by default and accept an explicit branch selection for exploration. Browser checks SHALL use a single valid projection, and journeys and handoff SHALL default to chosen branches. Tool results that resolve a variant selection SHALL identify the effective projection; distinct rendered inputs SHALL NOT overwrite another projection's screenshot.

#### Scenario: Inspect an unchosen alternative
- **WHEN** the agent queries or captures an explicitly selected unchosen branch
- **THEN** the result identifies that branch, sees its specific nodes, and leaves the default chosen projection unchanged
