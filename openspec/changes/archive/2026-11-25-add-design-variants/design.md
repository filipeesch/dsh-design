# Design

## Context

Screen source is parsed and validated before fixture expansion, preview publication, or semantic inspection. The preview has owner-only routing and a headless single-canvas path; the native DSH panel embeds the same interactive route. Review comments already capture screen context and distinguish stable IDs from content-fingerprinted structural anchors. Tools currently read chosen screen data from the shared project runtime; design source is edited through standard file tools.

## Goals / Non-Goals

**Goals:** Use one variant resolution model for authoring, preview, checks, comments and the later handoff. Preserve stable IDs across valid alternatives. Keep side-by-side interactions independent. Diff local history without touching checkout state. Keep source edits and local discard handling explicit.

**Non-Goals:** Branch creation or checkout, automatic promotion, visual merge, arbitrary multi-pane comparisons, comparison-wide journeys, new mutation endpoints, or generated handoff files in this change.

## Decisions

### D1. Resolve variant wrappers before kit validation and rendering

Give each group a screen-local unique stable ID and a required chosen branch ID. Each branch declares its own sibling-unique ID. Branch identity describes selection, not a component ID. Reuse the restricted syntax parser and preserve source spans. Resolve whole-screen or subtree groups into ordinary kit nodes, project state and group metadata; never render wrappers as kit elements. A nested group selection exposes its ancestor path, choosing the necessary ancestors before applying that selection, with other active groups following their declared choices. Reject ambiguous or unknown routes rather than guessing. Validate all reachable projections, including branch combinations for duplicate IDs and references. Bound validation work and report a source-located limit diagnostic rather than knowingly publishing unvalidated alternatives. Check fixture-expanded IDs, child constraints and branch-dependent references at the same shared projection boundary. Publish valid alternate projections and the chosen fallback coherently; failed reloads must not mix revisions. Use the single resolved chosen tree for existing callers by default and for the later handoff.

### D2. Share comparison inputs, isolate canvas interaction

Track screen, variant group/selection, breakpoint and named state in existing preview routing. Single variants and comparison links are read-only and restore on history navigation. Use two isolated interactive preview contexts in comparison so duplicate IDs, modal focus, fields and navigation do not collide. Same-origin child previews are a straightforward way to reuse existing modal behavior; use another composition only if it provides the same isolation. The parent controls comparison selection, breakpoint and starting state. Navigation from inside a pane affects only that pane; editing a shared selector resets the starting view of both. Keep branch and Chosen labels visible and retain exact breakpoint widths; put horizontal scrolling inside the comparison region with keyboard access and a discoverable mobile affordance. Deterministic preview and browser checks continue to render one resolved canvas with no subsequent requests. Gather comment context from the effective projection, including chosen branches, not just the URL; keep the pending queue per session and filter pin anchoring by the recorded branch context. Preserve pre-variant behavior for screens without groups.

### D3. Semantic diff uses projection data, not Chromium or a checkout

Project both selectors into ordinary screen trees and derive stable ordered node records. Compare IDs first and use explicitly labeled structural fallback for unmatched anonymous nodes. Detect parent/order moves without classifying a mere index shift caused by insertion as moving all following nodes. Report prop/type/text changes separately from moves, with deterministic ordering. Git mode resolves locally available commit identities and reads only the corresponding committed design data from their trees. Load each revision's relevant design config, screen, tokens and fixture inputs using the same validation contracts; never substitute the current working tree for a missing historic input. Use a bounded read-only command interface with literal arguments and no staging, checkout, fetch, hooks, or external content loading. Unknown or invalid inputs return diagnostics, not partial silently mixed results.

### D4. Promotion uses normal text edits

No promotion tool or Git mutation is needed. Document how to record the rejected branch sources with origin and date under the design's ignored local discard directory before replacing the exact group with the selected children. Update generated ignore files for new projects and explain how an old project verifies its own rule first. Preserve the surrounding tree and unrelated groups. Validate the promoted source and inspect the normal preview. Cleanup is owner-requested, constrained to the canonical discard location, never follows symlinks, and does not affect versioned or unrelated output. Prefer a checked, documented workflow over silently moving files from the browser.

## Risks / Trade-offs

- Alternative combinations can expand quickly; enforce a documented budget up front and reject unvalidated source with an actionable diagnostic.
- Pane geometry exceeds narrow viewports; use internal scrolling rather than scaling or breaking chat layout.
- Historical projects may have changed their pinned kit or be incomplete; report explicit compatibility or missing-input diagnostics.
- Renaming a group or promoting it can orphan review drafts from that branch; keep them reviewable without reattaching onto unrelated nodes.

## Migration Plan

Projects without Variants require no migration. New scaffolds ignore the discard directory; existing projects only need that ignore rule before discarding. Removing an exploration block restores ordinary source and preview behavior. The discarded records are local by design and can be removed explicitly.
