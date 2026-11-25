# Design

## Context

The external bundle already loads a Web client contribution. DSH exposes a right sidebar registry, a keyed session-scoped tab slot, and conversation header utilities. The plugin serves an owner-only interactive preview and a separate self-contained deterministic document. Its kit places identity metadata on rendered components. The DSH session controller exposes queued prompt admission with an explicit request ID and acceptance result.

## Goals / Non-Goals

**Goals:** Integrate with the host layout rather than build a second renderer. Review and talk in the same session. Keep pending drafts separate from repositories and send a single normal message only on explicit owner action. Preserve deterministic rendering.

**Non-Goals:** Versioned drafts, draft persistence across host restart, cross-user collaboration, free-form input capture, background sending, agent-side draft tools, and variant authoring.

## Decisions

### D1. Native session sidebar and same-origin preview

Register a Design tab through the existing right sidebar service and keyed body slot, and add an action in the session header. Use the tab body's session props, not a cached global session: update the preview frame and the standalone link when identity changes. Load the existing interactive document in a titled, same-origin frame. Preserve owner admission and restrict framing to the owning origin; keep deterministic previews unembeddable and unchanged. Use host layout, theming and available localization seams without extending DSH or manipulating its DOM. Keep exact breakpoint geometry and scroll within the frame when the pane is narrow. Surface loading or missing-project guidance. On narrow screens use the host pane's navigation to return to the conversation.

### D2. Component identity and bounded interaction context

Reuse one review interface inside the interactive renderer for both standalone and embedded previews. In comment mode intercept component selection before normal control activation and offer a keyboard component picker over the same visible nodes. Resolve the nearest design identity and position pins from current geometry on resize, scroll and revisions. Store a stable or fixture-derived node ID, or a structural address tagged with a rendered-content fingerprint; keep the numeric project revision only for diagnostics. Capture screen, breakpoint, node type, named state if present, active overlay IDs, and tab selections; leave an optional typed variant identity for a future change. Do not capture free-form field values, secrets, screenshots, or arbitrary DOM content. Comments stay plaintext. Retain stale or missing anchors in the queue without guessing a new location; distinguish off-screen comments from missing nodes. Preserve existing modal focus outside review, coordinate keyboard focus during pinning and restore it after closing the composer.

### D3. One bounded host draft store per DSH session

Store pending drafts and bounded batch receipts in host memory, keyed by session ID, never by the design folder. Reloads reconnect to the same authority; process restarts do not restore pending drafts. Clear drafts on actual session removal or plugin disposal. Provide a dedicated endpoint for list, create, edit, remove, and submit. Admit only a recognized owner and verify same-origin mutation intent and bounded typed JSON input. Resolve session identity exclusively from the authorized route rather than the payload. Use draft revisions to reject stale mutations, and submit exact reviewed versions so later edits or drafts cannot be cleared unintentionally. Refresh on load, focus, and successful changes; make conflicts and delivery errors visible. Deterministic previews never render review controls or call comment endpoints.

### D4. One idempotent ordinary chat message

Format the reviewed batch into a normal user message: number each item, include typed anchor and interaction context, and clearly separate plain comment text from metadata. Use the host session prompt service in queue mode with a stable request ID for the batch. Never steer a running turn. Serialize sends, preserve pending drafts on failure, and clear only their acknowledged versions. Retrying an accepted batch returns acknowledgement without another message. If the host controller is unavailable, expose a clear retryable failure rather than simulating success. Verify the host call, conversation delivery, and the external browser slot with the actual packed plugin in a disposable DSH profile.

## Risks / Trade-offs

- Client seams are deployment-sensitive. Verify the native slots and owner-authenticated frame in the installed bundle before implementing workarounds. Do not change the DSH source checkout.
- Pending comments are intentionally ephemeral. Explain that reload is supported, but process restart is not.
- Structural anchors and valid hot reload need conservative reconciliation. Keep unresolved drafts reviewable rather than reusing an address on unrelated components.
- Wide breakpoints can exceed the sidebar width. Scroll the preview internally instead of shrinking the measured design or expanding the host page.

## Migration Plan

No project or session-data migration. Existing links, design files, deterministic snapshots, and journeys keep their contracts. Removing the plugin discards unsent in-memory drafts.
