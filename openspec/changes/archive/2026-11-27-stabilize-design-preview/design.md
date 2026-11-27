# Design

## Context

The Design client mounts a same-origin iframe and keeps it mounted; the separate-tab link opens the same session URL. The interactive renderer opens one EventSource per document, including comparison panes. The host shares a watcher by design folder but not the browser connection. In the installed 0.1.3 bundle on local HTTP/1.1, a control request completed with five revision streams, did not reach the server with six, and completed immediately after a stream was closed. Two previews alone did not reproduce the stall. See [proposal.md](proposal.md) for scope and [the spec delta](specs/design-preview-server/spec.md) for the response and transfer criteria.

## Goals / Non-Goals

- Keep the fix inside the plugin and the existing same-origin owner admission. No new listener, reverse proxy, external service, dependency, or required host feature.
- Make idle revision checks independent of project size and render data proportional to the requested screen, not the number of screen trees in the project.
- Keep current review appearance and interaction. No visual design reference applies. Verify the existing panel, standalone preview, and comparison behavior, including the existing mobile and desktop breakpoints, without introducing new controls or changing agent tools or the deterministic renderer contract.

## Decisions

### Use short revision checks instead of persistent HTTP streams

Replace the interactive EventSource and retire its streaming handler. Use a short same-origin GET that returns an opaque runtime-generation/revision token and never waits for an edit. Reuse the existing per-folder project runtime and debounced watcher; a steady-state check reads the published token without reading the project files, building a payload, or serializing a tree. Keep the watcher alive while interactive checks renew its idle lease, then stop it after the existing idle window. A restart or runtime eviction must produce a distinct generation even if its numeric revision restarts. Cold or restarted watching must not leave a stale snapshot or lose an edit between initialization and the first check. Do not change the validation-tool lifecycle or its explicit reload path.

Use a non-overlapping active-document schedule, initially 350 ms between successful checks, leaving time for the watcher and render within the one-second budget. Back off boundedly on errors; abort obsolete requests and clean up timers on teardown. Suspend periodic checks when the document is hidden; check immediately on visibility return or page restoration. Within one JS document, coalesce callers for the same session, and keep revision response bodies small and non-cacheable. Do not use long polling: waiting HTTP requests would retain the same finite connection slots. Cross-tab stream leadership would keep push semantics but adds failure and handoff complexity, and the DSH WebSocket upgrade path adds another protocol and compatibility surface just to deliver a token.

### Send project summaries plus one screen projection

Keep the interactive project endpoint but shape its response into compact project-wide metadata plus the requested screen's render data. Resolve the explicit screen first or use the current entry/fallback rules; pass the requested screen even when there is no explicit variant. Preserve labels independently of tree props, groups, situations, diagnostics, theme configuration, and graph relationships; retain selected-branch graph semantics. Keep active-screen variants, states, and last-valid render data. Do not send current or fallback render trees for unselected screens. Reuse existing graph derivation, render selection, and validation logic; do not expand the deterministic or headless payload path.

Return data and its token from the same published snapshot. Re-request the current selection on token changes, and request newly selected screen or variant data on route changes. Cancel or ignore late responses across route/session changes and refresh again if a newer token was observed during the fetch. Do not prune other screens' saved interaction state just because their trees were not sent; reconcile state when authoritative screen data is present and remove state for truly deleted screens. Preserve invalid-input, last-valid, focus, and comment behavior. Do not use browser persistence of full render responses as a prerequisite for the byte reduction; cache-only or compression-only changes would leave the eager transfer and parsing of unrelated screens intact on a cache miss.

## Risks / Trade-offs

- Periodic requests replace idle streams. Keep the steady-state handler constant-work, stop checks when hidden, and assert in tests that idle checks do not transfer render data or re-read source inventory. The one-second gate applies when the browser is executing normally; foreground catch-up must not depend on replaying missed events.
- A screen switch now depends on a request. Keep the navigation model available while fetching without presenting a previous screen as the new selection. Test rapid switches, history, variants, and invalid-to-valid edits.
- Partial payload and graph navigation can drift. Assert the expected map and label semantics on both default and explicit projections, as well as preserved state for revisited screens.
- The host keeps recovery seeds for the four most recently idled preview folders without retaining their watchers. Recovery after that seed is displaced, or after a host process restart, is best effort until a valid source is read again.
- Host restart during an open preview can reset counters. Compare the opaque token rather than assuming numeric revisions only ever increase, and recheck after reconnect or resume.

## Migration Plan

Ship the preview host and renderer together in the plugin bundle. No data or configuration migration is needed. Already-open previews can reload once at deployment to obtain the matching renderer. Roll back by reinstalling the preceding bundle; no source or state format migration is involved.
