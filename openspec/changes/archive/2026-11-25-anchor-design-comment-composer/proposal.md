# Proposal

## Why

The current comment pin marks the selected component, but the editor opens in the lower corner of the preview. Moving the editor next to the selected component keeps the feedback and its target visible together.

## What Changes

- Open the comment composer as an overlay next to the component selected with a mouse or keyboard, with a pointer that identifies the target.
- Close the balloon on save and leave the existing pin; activating the pin reopens the balloon at its component.
- Fit the balloon within the visible preview pane and keep it aligned as the pane scrolls or resizes. Preserve an editing path in Pending for a draft that no longer has a usable anchor.
- Target authoring on a desktop browser, including when the desktop user selects the Mobile preview breakpoint. Do not add a phone-specific authoring flow or remove existing responsive previews.
- Leave the pending queue, batch submission, and deterministic output unchanged.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `design-comments`: Create and reopen comments in a component-anchored balloon rather than a fixed footer editor.

## Impact

The interactive renderer, its review styling, and browser regressions change. The host draft store, comment payload, and project files do not change. This is a separate delivery from variant remediation and must preserve branch-scoped anchors when integrated.
