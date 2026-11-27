# Proposal

## Why

A real Design session rebuilding and reviewing plugin mocks spent calls diagnosing a mismatched running build and repeatedly returned whole-screen data to answer local geometry questions. It also needed workarounds for real gaps in the kit; the next revision should make those workflows more direct while allowing shared layouts and light/dark renditions of the same screens.

## What Changes

- Identify the active plugin build and discover usable journey and render targets through status. Clarify existing tool schemas, fail on invalid selections rather than measuring or validating a fallback, and distinguish authored structure, measured layout, visual evidence, and infrastructure failure.
- Extend `design_view` with focused geometry and bounded comparison of explicit state, breakpoint, or theme selections in one call. Reproduce the safe interaction context of submitted review comments temporarily, without changing source or replaying an old revision.
- Add deterministic Portuguese and English intent search to `design_catalog`, retain exact and batch reference lookup, and add validated recipes for common compositions.
- Add `CodeBlock`, `Callout`, `ToggleButton`, `SelectButton`, and `SplitButton`. Anchor `Popover`, offer a visual switch presentation on `Switch`, target actual tabs in journeys, honor the `Drawer` width, support alternate `Disclosure` labels, and let a field fill available row space. Keep `Toast` behavior unchanged.
- Reuse a locally authored layout across screens with one slot for screen content; add selectable token palettes and local CSS restricted to classes explicitly applied to canvas nodes.
- **BREAKING:** Remove `design_handoff` and the dedicated export contract. Delivery shares existing source/evidence paths and the accepted selection; it does not create a new package or delete earlier exports. Previously accepted but invalid or ambiguous inspection arguments may now be rejected explicitly.

## Capabilities

### New Capabilities

None. The changes extend existing authoring, preview, and inspection capabilities.

### Modified Capabilities

- `design-agent-tools`: tool inventory, runtime status, validation and query contracts, focused comparisons, catalog discovery, and check results.
- `design-agent-preset`: concise authoring, inspection, review, and path-only delivery guidance.
- `design-comments`: safe, replayable interaction coordinates for submitted review comments.
- `design-dsl`: declarative layout composition and explicit stylesheet class references.
- `design-handoff`: retire the generated export contract.
- `design-headless-checks`: focused snapshots, clean comparisons, and theme-aware visual evidence.
- `design-journeys`: semantic targeting of subcontrols and explicit themed runs.
- `design-kit`: additional controls, layout and overlay fixes, token-backed palettes, and addressable interactions.
- `design-preview-server`: shareable theme selection, canvas-local styles, and live updates of shared sources.
- `design-project`: versioned layout, theme, and stylesheet inputs.
- `design-state-and-fixtures`: typed values and transient review-context initialization.
- `design-variants`: chosen-source defaults independent of exports and theme-aware comparisons.

## Impact

- Core parses, validates, and resolves shared sources; the host exposes typed tool contracts and reuses the browser runner; the renderer and kit consume a common resolved canvas input.
- The Design preset retains normal file authoring and exposes ten design tools; Standard does not gain design tools. Existing design projects need no new files or automatic pin migration. External consumers of `design_handoff` must switch to existing paths.
- The release bundle and its real dispatcher need coverage alongside unit tests and Chromium UI verification. Live app capture, arbitrary CSS, nested or parameterized templates, automatic host changes, and application-code generation are out of scope.
