## Context

See [the proposal](proposal.md) for the motivation. The preview already resolves a session, screen, breakpoint, named state, and optional branch; applies live state through the kit; and separates the deterministic canvas from the interactive host. The host currently formats most tool results inline, and the handoff planner already follows navigation references in chosen source. Extend those seams rather than introducing a second renderer, workflow engine, or source of truth for navigation.

## Goals / Non-Goals

**Goals:** Use the same authored selectors and resolved projections across tools, preview, and handoff. Keep project sources portable and review state transient. Add expressive, semantic local interactions without encoding product-domain rules. Keep the model-facing workflow compact and provide evidence at the point where it prevents rework.

**Non-Goals:** No Figma-style editing surface, manually laid-out flow document, general-purpose condition language, reusable DSX partials, token mutation tool, automatic simulation or browser installation, external media, live app capture, or display of review chrome in headless artifacts. Multi-screen batch lint is not required by this change; a single lint request still measures all configured breakpoints by default.

## Decisions

### 1. Keep review metadata beside, not inside, rendered design source

Use one optional bounded `design/preview.json` file. The shape is a plain-text screen context table keyed by screen ID (`summary`, optional `details`), ordered `groups` (IDs, labels, and screen references), ordered `situations` (stable ID, label, parent screen, and destination), and labeled `relationships` (stable ID, `illustrative` or `simulated`, and local source/destination references). An endpoint is a screen ID or an authored situation reference; situations resolve to `{ screen, state? }`. Keep visual branch and breakpoint selection out of metadata. Pass only normalized, validated data to consumers; do not render metadata as HTML. Use bounded arrays and strings and reject ambiguous aliases, ambiguous duplicate situation destinations, and invalid or out-of-project references. Treat a situation with an unqualified destination as valid when it is an unambiguous alternate entry under another screen. Use title then ID as the fallback for unauthored labels.

Load metadata after resolving screens and named states. Report syntax and reference problems with actionable locations through the project validator and preview diagnostics; omit invalid entries and preserve the valid canvas even when the metadata file cannot be read. Include metadata in live reload and the edit fingerprint, but not in render-geometry identity. Do not require a scaffold migration. Storing this content in Markdown would be pleasant for prose but less reliable for typed endpoints and validation; putting it in the screen DSL would couple review chrome changes to canvas source.

### 2. Derive a common relationship model; keep interaction execution local

Extract a pure traversal of resolved navigation references, preserving the source screen, source node identity when available, target, and a useful label with a stable fallback. Reuse it for the preview relationship model and existing handoff target discovery. Do not derive relationships from file names, user comments, journey assertions, or local state changes. Derive prototype navigation from chosen projections by default; replace the active screen contribution when viewing a valid explicit branch. Mark or omit stale evidence rather than showing it as current. Links inside a tab, drawer, or disclosure represent actions defined in that projection, not necessarily visible at the current moment. Opening a node on the map visits the screen or situation; it does not invoke the underlying action or simulate a result.

The map starts with the active screen, its authored situations, and incoming/outgoing relationships; the full view includes disconnected screens. Use deterministic automatic layout with bounded rendering and a keyboard-operable text equivalent rather than a new graph editor or dependency by default. Present entry, current selection, and the three edge kinds explicitly. Resolve simulation eligibility against the authored route (not mutable field values); an explicit control in the review chrome navigates to the declared destination. Keep breakpoint on same-session navigation; clear branch and state selectors when they do not apply to the destination. Do not infer a next step or introduce a new navigation verb. Continue to support the existing screen/state/variant deep links and browser history.

### 3. Compose review surfaces around the existing canvas

Keep a screen navigator, screen context, flow map, and simulation controls as small renderer components that consume a normalized view model and receive route callbacks. Compose them outside the canvas; keep the existing comment compositor and embedded session boundary. Default to a sidebar with a compact header at roomy widths and a dismissible navigator in embedded or narrow previews. Retain mounted canvas state when opening contextual chrome; focus management, ESC handling, and browser history must not accidentally advance the workflow or activate a comment target. Deterministic rendering uses neither the review components nor a viewport modified by them.

### 4. Add kit behavior and opt-in styles, not application logic

Use existing kit metadata and token resolution for compact tabs and compact icon controls while preserving current defaults. Keep a meaningful tablist, selected state, and keyboard behavior; use a named button for icon actions. Implement Disclosure as a labeled, addressable button controlling its own content, with its expanded state stored through the existing kit/renderer state boundary and associated with the stable resolved node ID. Extend named-state validation and seeding with a Disclosure-only boolean map, rather than treating expansion as an overlay or a generic writable property. Ensure the same state is respected by previews, inspection, and deterministic checks; keep local edits distinct from authored seeds. Use the existing kit compatibility policy for additive behavior.

### 5. Separate projection selection, runtime readiness, and evidence

Introduce small typed check-selection and result adapters around the current host services. Resolve screen, variant, state, and breakpoint through the existing projection primitives; validate before acquiring the browser, reject unknown options, and use the resolved identity in output and capture. Keep project/browser dependencies injectable for unit tests. Status can inspect configuration and a verified browser launch outcome without starting Chromium; executable presence is not a sandbox readiness guarantee. Report the effective runtime/profile installation context rather than suggesting that the target app install Playwright. Never install automatically.

Extract a media diagnostic path alongside the existing passive-raster collector; report missing, rejected, and failed-to-decode media with project-relative references. Keep it separate from geometry and do not count the failed asset fallback as a layout fault by itself. Capture still writes the deterministic PNG under the ignored cache. Attach it through the native DSH image-result boundary when supported, while keeping bytes out of structured/text results; otherwise retain the artifact path and explicit fallback. Do not loosen browser sandbox policy or expose another project’s files.

### 6. Trim the agent loop rather than replace generic tools

Build catalog entries from kit metadata plus a small curated registry of actual syntax constructs and reusable recipes. Keep the no-argument index and single-name details compatible and add a bounded batch lookup with explicit per-entry outcomes. Share examples with validation fixtures where possible. Isolate the touched tool formatting and diagnostic comparison helpers; do not rewrite all registrations. Compare diagnostic identities before and after the relevant tool call, grouping nested changes at the outer call and using stable codes/context so unrelated location shifts do not produce noise. Explicit validation is still authoritative. Fit guidance into the existing prompt budget and keep literal DSX protected from interpolation.

### 7. Keep handoff informational and selected

Add a deterministic manifest section for durable context and relationships relevant to selected projections, with stable identifiers, edge kinds, and explicit distinction between selected and outside evidence. Use chosen-source edges for the export. Omit the preview affordance and executable metadata for simulation; describe the proposed outcomes without treating them as implementation controls or adding them to the render/source closure. Include the projected metadata in the content identity so a meaningful change cannot overwrite earlier output. Do not read session comments for this export.

## Risks / Trade-offs

- **Preview metadata diverges from source** → Validate against current source, derive all actual navigation, and disable invalid references without hiding the error.
- **Large or cyclic graphs degrade readability** → Use the focused neighborhood by default; keep the full view scrollable and provide a deterministic text representation with all destinations reachable.
- **A clean check is mistaken for design fidelity** → Label selection and measured results; return actual imagery and distinguish media issues. Evaluate visual fidelity separately.
- **State and browser compatibility drift** → Exercise deep links, branch changes, comment mode, narrow embedding, legacy projects, renderer tests, and real-browser harness tests. Check image-capable and path-only responses.

## Migration Plan

Existing projects need no new file, no required migration, and no changes to default kit styling. Authors can add metadata and opt into new component features independently. Older clients can ignore additive handoff fields; fall back to earlier plugin behavior by omitting optional metadata and not using newly introduced kit features, without deleting source or cached evidence.
