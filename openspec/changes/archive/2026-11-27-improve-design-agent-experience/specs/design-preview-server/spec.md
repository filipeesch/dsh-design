# design-preview-server delta

## ADDED Requirements

### Requirement: Theme-aware canvas routes
A project with multiple valid palettes SHALL offer a theme selector in the interactive preview outside the design canvas. A shareable `theme` query parameter SHALL restore the selected palette on a fresh load and history navigation. The effective theme SHALL be maintained across within-project navigation, including situations and comparisons, and a theme-only change SHALL preserve compatible live control state. Absent explicit theme selection SHALL use the project default (the base palette if no default is specified), not OS preference. Unknown or invalid explicit themes SHALL be diagnosed with no silent substitution. The theme controls only the design canvas, not the DSH chrome.

#### Scenario: Open the same layout in the dark palette
- **WHEN** a reviewer switches to the authored dark palette while a drawer is open and then shares the link
- **THEN** the live drawer stays open, and a fresh visit to the shared link restores the dark palette and authored link state, not the previous viewer's transient input

### Requirement: Canvas-local shared sources
Edits to local layout, theme, and stylesheet sources SHALL participate in normal validation and live reload. The preview SHALL apply the same resolved layout, theme and class declarations as a deterministic render. Invalid changes SHALL retain the last valid rendition where available with actionable diagnostics; an unused or invalid source SHALL NOT introduce effects outside a consuming canvas.

#### Scenario: Edit common navigation and styling
- **WHEN** a shared layout's header and an explicitly applied class change on disk
- **THEN** each open consumer updates without rebuilding and no DSH chrome or unrelated canvas inherits the authored class
