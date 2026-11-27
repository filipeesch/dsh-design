# Tasks

## 1. Revision transport

- [x] 1.1 Replace the HTTP event stream with an owner-only short revision response and renew the shared watcher lease from preview activity. Verify stable tokens and no source reads on warm unchanged checks, updates after edits, new generations and fresh data after idle restart, owner denial, and teardown in host route/runtime tests.
- [x] 1.2 Switch interactive documents to non-overlapping revision checks with bounded error recovery, cleanup, and visibility/page restoration. Verify unchanged revisions never fetch render data, and cover startup, resume, restart, and deterministic mode in renderer tests.

## 2. Initial preview data

- [x] 2.1 Return compact project navigation metadata and the selected screen projection and stamp the response with its source snapshot token. Verify omitted unrelated trees, default and explicit selections, variant graph semantics, invalid input, and last-valid data in host payload/route tests. Preserve the deterministic payload and browser-check interfaces.
- [x] 2.2 Fetch the selected projection on screen or variant changes and reconcile updates without stale responses or state loss for unselected screens. Verify deep links, fast navigation and history, diagnostics and recovery, state preservation, comments, map navigation, and comparisons in renderer tests, covering the existing mobile and desktop configurations.

## 3. Integration and evidence

- [x] 3.1 Add an HTTP/1.1 Chromium regression covering at least six actual preview documents in one browser context with an embedded panel and a standalone tab. Assert a same-origin control request completes while those documents remain open and no long-lived revision response remains. Verify a foreground edit appears within one second, a hidden preview catches up on return, and unchanged sources trigger no periodic render payload.
- [x] 3.2 Use an identical, reproducible 30-screen fixture for the baseline and candidate, with the agent idle. Record the compared builds, screen and cache setup, and transferred preview response-body bytes through the first canvas in the standalone tab opened from the panel; require a measured reduction and working navigation. Use a packed candidate on a disposable DSH Web profile off port 3080 for the installed-path smoke, and record the measurements and tested limits in the verification evidence.
- [x] 3.3 Run the project checks, the targeted Chromium regression with a real browser, and strict OpenSpec validation. Record actual pass/skip outcomes and distinguish the reproduced DSH blockage from the unverified system-wide slowdown.
