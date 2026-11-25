# Proposal

## Why

Exploring a design means trying alternatives and comparing them side by side before choosing. Git branches keep history but do not show alternatives next to each other, so the comparison that makes exploration useful is missing.

## What Changes

- DSL support for variants of a whole screen or of any subtree (`Variants` with `Variant` children and a `chosen` marker).
- A compare mode in the preview that renders variants side by side at the same breakpoint and state, with each variant still interactive.
- Promotion: the chosen variant replaces the variants block in the source, and the other variants move to `design/.discarded/`, a git-ignored folder, with their origin and date. A cleanup step empties it when the exploration ends.
- `design_diff`: a semantic diff (nodes added, removed, moved, and props changed) between two variants or between two git revisions of a screen.
- Only chosen variants count for the handoff; comments record the variant they were made on.
- Promotion is a direct source edit guided by the preset, not a new mutating tool or a browser action.

## Capabilities

### New Capabilities

- `design-variants`: variant syntax, compare mode, promotion, the discard folder, and its cleanup.

### Modified Capabilities

- `design-dsl`: `Variants` and `Variant` elements and their validation.
- `design-project`: the git-ignored `.discarded/` folder.
- `design-preview-server`: compare mode.
- `design-agent-tools`: `design_diff` and variant awareness in existing tools.
- `design-comments`: isolate pins and preserve variant context.
- `design-agent-preset`: guide exploration, promotion and explicit cleanup without a new writer.

## Impact

- Discarded variants exist only on the machine where they were discarded; a fresh clone or a cleanup removes them by design.
- Benefits from the panel change (comments per variant) but does not depend on it.
