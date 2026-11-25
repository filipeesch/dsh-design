# Design

## Context

The interactive renderer already resolves commentable elements, places pins against their geometry, and manages review keyboard behavior alongside kit drawers and modals. The composer currently shares the fixed review surface with the Pending queue. The native Design panel and standalone preview use the same renderer; the comparison renders isolated preview panes. The selected canvas breakpoint is independent of the physical device hosting the editor.

## Goals / Non-Goals

**Goals:** Make the target and editor visually adjacent during desktop authoring, reuse the existing anchor and draft lifecycle, and keep the balloon usable in a narrow desktop sidebar and in Mobile layout preview.

**Non-Goals:** A touch-first or phone-specific authoring interface, changes to preview breakpoints, new comment storage or transport, and changes to batch delivery or deterministic rendering.

## Decisions

### D1. Resolve the target within the current preview document

Use the existing selected component identity and pin resolver. Create and pin-edit interactions open the same editor in an overlay layer above the live canvas, without adding layout space or inserting controls inside the kit component. Resolve anchors only in the current screen and effective review context, including variant identity where available. Keep Pending as a separate summary and provide non-anchored editing there for saved drafts with no currently visible or trustworthy target. Never substitute a different component or pane. Preserve any unsaved text if the anchor temporarily disappears and make the unavailable target explicit.

### D2. Fit the balloon to visible pane geometry

Measure the target and the balloon in one coordinate space within the preview document. Prefer an adjacent position with a gap and visible pointer; flip to another side or shift within the pane if the preferred position does not fit. Use width and height constraints and internal scrolling when the pane is narrow, not a new full-width footer mode. Recompute for scroll, resize, target replacement and relevant layout changes. Isolate stacking and pointer events so the balloon is usable above an open drawer and ordinary canvas controls behave unchanged when not in comment mode. Treat the desktop browser and the chosen Mobile canvas width as independent inputs.

### D3. Retain keyboard and focus contracts

Keep pointer and keyboard target selection, composer focus, Escape, and focus restoration. While the editor is open over a drawer, review controls must be reachable without disabling the surrounding drawer's focus guarantees when the editor closes. Selecting, saving, and dismissing must not activate the underlying kit control. Render no balloon or review requests in deterministic mode.

## Risks / Trade-offs

- A target near a scroll boundary can move or become clipped. Position against the visible target, never leave a pointer falsely connecting to unrelated content, and restore placement when the same anchor becomes usable.
- The DSH sidebar or comparison pane may be narrower than the desktop browser. Verify the actual pane bounds and existing horizontal scrolling rather than assuming the browser width is the available width.
- Variant remediation also changes the review renderer. Develop separately, then integrate and revalidate against the approved variant implementation without mixing delivery contents.

## Migration Plan

No source or draft migration. The change affects presentation only and preserves existing pins, pending drafts and batch submissions.
