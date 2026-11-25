# Tasks

## 1. Extend the project model

- [x] 1.1 Add typed, validated named-state declarations to screen loading and keep only validated metadata with current and last-valid trees; verify invalid assignment diagnostics and last-valid retention in core tests.
- [x] 1.2 Read bounded project-local JSON fixtures and normalize list templates, table rows, and select options into the kit tree; verify missing/type/duplicate diagnostics, empty collections, key-stable expansions, and existing inline content in core tests.
- [x] 1.3 Parse and validate declarative journey files and references; integrate fixture and journey errors into project/file/screen validation and edit summaries; verify valid and invalid DSL with source-located diagnostics.

## 2. Use named states in the preview

- [x] 2.1 Share validated state metadata between normal and deterministic payloads and expose `?state=` routing; verify direct links, invalid-state diagnostics, history, and one-time initialization in browser tests.
- [x] 2.2 Reconcile fixture expansions and named state with persisted interaction on valid hot reload; verify that repeated rows retain IDs on reorder and owner interactions survive compatible edits.

## 3. Add isolated Chromium checks

- [x] 3.1 Package a lazy Chromium runtime for the deployed bundle; verify actual packed install, correct missing-browser guidance, reuse by session, cross-session isolation, and disposal on session/plugin shutdown.
- [x] 3.2 Render an immutable project snapshot using the existing self-contained deterministic document, with bounded execution, cancellation, and no network; verify in Chromium with ordinary synthetic fixture runs and cancellation/timeout checks.
- [x] 3.3 Execute ordered typed journey actions and assertions on real kit controls; verify passing and failing cross-screen journeys, stable per-step results, first-failure snapshot, and no later steps on failure.
- [x] 3.4 Read bounded canvas-relative computed geometry and semantic node data and implement deterministic layout lint; verify mobile/desktop measurements and rule findings without reporting intentional overlay or ancestor containment.
- [x] 3.5 Create deterministic canvas-only PNGs with optional target highlight and canonical cache confinement; verify content, same-input path, highlight, and no writes to design sources.

## 4. Expose the workflow to the agent

- [x] 4.1 Register structured journey, lint, screenshot, and static query tools and extend `design_view` with optional state and computed layout; verify typed results, deterministic ordering, missing-browser handling, and ordinary static inspection without a browser.
- [x] 4.2 Document a runnable synthetic example and add concise preset guidance; verify preset size and tool visibility, fictitious fixture guidance, and screenshots remaining opt-in.

## 5. Verify the deliverable

- [x] 5.1 Run the full project check and strict OpenSpec validation and verify the packed plugin in a disposable real DSH profile, covering the new tools and real responsive preview at desktop and mobile sizes. Record reproducible commands and evidence in English without tokens or machine-specific paths.
