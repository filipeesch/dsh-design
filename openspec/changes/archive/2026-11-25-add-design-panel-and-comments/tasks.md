# Tasks

## 1. Integrate the session panel

- [x] 1.1 Register a Design action and native session-scoped right sidebar tab with a titled same-origin preview frame and standalone link. Verify the packed Web client registers the action and follows the selected session.
- [x] 1.2 Preserve owner admission and deterministic framing restrictions, and handle loading, missing design, narrow panes and return to chat. Verify the installed GUI at desktop and 390 CSS pixel widths.

## 2. Store and submit comment drafts

- [x] 2.1 Implement a bounded in-memory draft store keyed by session plus revision-aware editing and removal. Test same-project session isolation, stale version handling, reload and session removal.
- [x] 2.2 Expose the owner-only comment endpoint with route-scoped session identity and bounded same-origin JSON mutations. Verify normal authorized reads and writes, rejection for invalid inputs, unchanged deterministic preview and no repository writes.
- [x] 2.3 Connect explicit batch submission to ordinary queued DSH user prompt admission. Test serialized submission, acceptance, idempotent retry, failure retention, and preservation of drafts added during a send; confirm real DSH records one chat message.

## 3. Pin and review in the interactive preview

- [x] 3.1 Add pointer and keyboard target selection without activating kit controls. Capture only the specified typed context, anchor identity and revisions; verify selection and focus in an open drawer and on an anonymous structural node.
- [x] 3.2 Add anchored pins, pending review, edit/remove/send, clear errors and acknowledgement. Verify pin alignment across responsive resize, scroll and reload, stable IDs on live edits, and safe marking of stale or missing targets.
- [x] 3.3 Add concise preset guidance and document the review loop. Verify prompt size, normal preview interactions and headless checks remain unchanged outside review mode.

## 4. Verify the installable delivery

- [x] 4.1 Run the full check and strict OpenSpec validation, pack the bundle, and verify the real DSH Web GUI in a disposable profile: two sessions, separate-tab and panel drafts, rejected delivery recovery, and one accepted batch. Document repeatable synthetic desktop and mobile review steps and evidence without credentials or machine-specific paths.
