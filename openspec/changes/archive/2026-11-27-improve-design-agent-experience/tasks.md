# Tasks

## 1. Establish integration coverage and retire export

- [x] 1.1 Establish an installed-bundle dispatcher regression harness with fixed bundle provenance, a Design session and a Standard session; verify it captures registered schemas, canonical results and ordinary output rather than calling fake execute methods.
- [x] 1.2 Freeze a five-request real-model evaluation on synthetic fixture data before tuning; record the request text, expected observations, model and bundle pins, and a baseline through the DSH UI. Verify that each before/after comparison is feasible in both builds and that the expectations are never sent to the model. Track new capabilities separately in deterministic tests.
- [x] 1.3 Remove the export registration, planner, export-only public code and package publication helpers, and replace guidance and live documentation with path-only delivery. Verify the ten-tool Design inventory, unchanged Standard isolation, screenshot cache confinement, and preservation of pre-existing export files.

## 2. Resolve shared authoring sources

- [x] 2.1 Share the bounded, confined source inventory across current project loading and edit fingerprints; test layout, theme, and declared stylesheet create/edit/delete, missing files and out-of-folder paths, and no delta for unrelated edits.
- [x] 2.2 Parse named layouts and compose exactly one slot before fixture expansion and named-state validation. Test two consumers, missing or multiple slots, nested declarations, source positions, duplicate resolved IDs, and variants using different layouts.
- [x] 2.3 Resolve typed theme overrides over base tokens with deterministic defaults. Test valid merged aliases, missing or invalid theme inputs, cycles and type conflicts, and no migration or base-appearance change for a legacy project.
- [x] 2.4 Parse and validate declared CSS files and literal class references with bounded declarations and deterministic precedence. Test simple valid classes and reject unknown classes, selectors other than single classes, at-rules, imports, URLs, and unsafe inputs without applying them.
- [x] 2.5 Resolve these inputs consistently in historical Git reads and current branch projections. Verify a shared layout change appears in semantic diff and historical comparison never borrows a current worktree dependency or changes the checkout.

## 3. Render and exercise the updated kit

- [x] 3.1 Reuse scoped class declarations and effective token palettes in both renderer paths; cover opt-in class precedence, isolation between canvases and chrome, and token-backed defaults for statuses, focus, and controls. Assert no external stylesheet requests and unchanged base defaults for existing projects.
- [x] 3.2 Add the theme selector and route propagation, and wire new sources into live reload and last-valid recovery. Test shareable links, browser history, navigation and comparison under a shared theme, invalid explicit theme, and preservation of active controls across a theme-only change.
- [x] 3.3 Add CodeBlock and Callout to the kit and metadata. Verify literal whitespace, long-line containment on mobile, persistent inline feedback, tone tokens, and searchable, valid examples.
- [x] 3.4 Implement ToggleButton and SelectButton with stable identities and validated named-state values; offer the opt-in visual Switch. Test pointer and keyboard operation, disabled controls, selected or pressed semantics, and unchanged legacy switch behavior.
- [x] 3.5 Implement Popover anchoring, edge clamping, and SplitButton primary and alternate actions with a shared focused positioning primitive. Verify distinct actions, keyboard selection and focus return, anchorless compatibility, and unchanged Toast interaction.
- [x] 3.6 Fix semantic Tab trigger targeting, responsive Drawer width, optional expanded Disclosure labels, and opt-in Input growth. Verify one addressable tab target, width within mobile canvas bounds, label and focus behavior, and fitting the field beside a desktop action without altering old defaults.
- [x] 3.7 Extend journey theme and typed subcontrol handling. Test that an initially inactive tab can be tapped, segmented and toggle values can be observed, split actions are distinct, the theme survives screen navigation, and missing targets identify the failing step.

## 4. Improve inspection contracts and review evidence

- [x] 4.1 Normalize typed inputs and results at the tool boundary and expose active build metadata, themes, and journey discovery in status. Test invalid and ambiguous validation/query scopes, correct source diagnostics, non-launching status, and bundle and kit identity distinction through the dispatcher.
- [x] 4.2 Capture safe review coordinates in the submitted batch and resolve them as temporary initial overrides. Verify tab choice, explicit empty overlay sets and false Disclosure values, theme, stale-target refusal, omission of typed values, and no changes to source or owner state.
- [x] 4.3 Implement subtree-scoped legacy measurement and the focused geometry case contract using one immutable project and asset snapshot. In Chromium verify order, compact output, visibility vs absent IDs, filtering before the cap, no PNGs, editable source during a batch, independent case states, and rejection before renderer startup for invalid input.
- [x] 4.4 Apply explicit themes to lint, journeys, and capture and use effective selectors and render inputs in screenshot identity. Verify deterministic repeat captures, different theme/style captures without overwrite, and image-inline and path-only delivery on supported routes.
- [x] 4.5 Make browser errors stable across installed module boundaries and reduce duplicate loads where measured. Verify unavailable Chromium, timeout, cancellation, ordinary lint and failed assertions via the real dispatcher; preserve current-source validation, warm browser isolation, and edit deltas through nested and generic writes.

## 5. Improve discovery and verify the release candidate

- [x] 5.1 Add bounded PT/EN catalog intent search and related reference links without changing index or exact/batch lookup. Test ranking, accent normalization, ties, no match, conflicting modes, and runnable snippets for the shared sidebar, action bar, drawer and fixture compositions.
- [x] 5.2 Revise compact preset instructions and authoring/release documentation. Verify prompt budget and Design/Standard separation, and provide path-only delivery examples plus a synthetic project exercising shared layout, themes, classes, review context and new controls.
- [x] 5.3 Run `pnpm run check` with real Chromium coverage enabled and the installed-bundle scenarios on an isolated DSH profile. Capture and inspect representative desktop/mobile, light/dark, and anchored-menu screenshots; record paths and any gaps alongside the project verification notes.
- [x] 5.4 Run the frozen real-model catalogue on the candidate and report per-request first-attempt correctness, round trips, tool-result volume and verified preview/artefact quality, using application evidence. Record tool and model pins and incomplete runs; keep historical transcript observations separate from measured before/after results.
