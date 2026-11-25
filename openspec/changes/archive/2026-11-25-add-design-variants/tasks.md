# Tasks

## 1. Resolve and validate design variants

- [x] 1.1 Parse whole-screen, subtree and nested Variants groups with preserved source locations. Test malformed and empty groups, missing choices, duplicate groups, legal nested selections and wrappers disappearing from the rendered tree.
- [x] 1.2 Resolve chosen and explicitly selected branches consistently, validate each reachable bounded projection and retain the last valid set on failed edits. Test exclusive stable ID reuse, duplicate IDs in a combined projection, fixture expansion, and invalid references in unchosen branches.

## 2. Render alternatives and review them in context

- [x] 2.1 Add owner-only single-branch and shareable comparison routes with breakpoint and named-state selectors, explicit diagnostics and independent pane interaction. Test exact canvas widths, history, live reload, isolated fields and modal focus, and keyboard-scrollable comparison at 390 CSS pixels.
- [x] 2.2 Pass effective branch identity through the existing comment composer, pins and batch context. Verify a comment on a stable ID shared by both visible panes pins only the branch it came from and remains in the session review queue.

## 3. Inspect, compare, and promote

- [x] 3.1 Make design status, validation, view, query and screenshot variant-aware while preserving chosen defaults for journeys and the single deterministic canvas. Test chosen and explicit requests, distinct screenshots, and actionable invalid-selection or state diagnostics.
- [x] 3.2 Implement deterministic design_diff for variant projections and two local Git revisions. Test stable moves versus insertion shifts, typed prop/text changes, missing historic inputs and unchanged worktree, index and branch.
- [x] 3.3 Teach direct-edit exploration, promotion and owner-requested discard cleanup; extend scaffold ignore rules. Verify a synthetic promotion preserves unrelated source, rejected source records are ignored, and cleanup does not touch live design files.

## 4. Verify the installable delivery

- [x] 4.1 Run full checks and strict OpenSpec validation, pack the bundle and verify desktop and 390 CSS pixel mobile comparison in a disposable real DSH profile. Document reproducible synthetic review steps covering chosen vs alternate, isolated interaction and comments, deep links, semantic diff, and cache/discard exclusions.
