# Proposal

## Why

A browser can run out of ordinary HTTP/1.1 connections to DSH when multiple Design previews keep revision streams open, making unrelated GUI requests wait even when the agent is idle. Opening a second view also transfers the complete project payload again: a 30-screen local project sent about 2.43 MB of JSON per view in the installed bundle.

## What Changes

- Stop interactive previews from indefinitely occupying the browser connections that ordinary DSH requests need. Keep the embedded panel, standalone tab, and comparison views live.
- Reduce the bytes transferred to display the first screen when opening a standalone preview with the panel already open. Keep the project navigator and map available without eagerly sending every screen tree.
- Preserve updates within one second on an active local preview, last-valid recovery, compatible interaction state, and existing preview URLs and controls. Catch up automatically when a browser-suspended document resumes.
- Verify the connection regression and the same-project byte reduction in Chromium with the agent idle; do not claim a fix for OS-wide slowdown that was not reproduced.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `design-preview-server`: Keep the DSH origin responsive with concurrent preview documents and reduce the initial preview transfer without changing interactive behavior.

## Impact

- Changes the internal request/response contract shared by the preview host and renderer; the public preview URLs and DSH panel interaction stay the same.
- Extends route and browser regressions, including coverage for the installed bundle on a disposable DSH Web profile.
- No visual design or mockup is required. Host-wide networking, agent tool validation, and deterministic/headless checks are outside the change.
