# Tasks

## 1. Workspace setup

- [ ] 1.1 Create the pnpm workspace with the `core`, `kit`, `renderer`, `host`, `client`, `preset`, and `bundle` packages (named `@filipeesch/dsh-design-<name>`), shared TypeScript config, and a test runner; verify `pnpm install`, `pnpm -r build`, and `pnpm -r test` succeed on the empty packages
- [ ] 1.2 Add lint and format checks, a `.gitignore` for build output, and an EOF-newline check; verify `pnpm run check` passes

## 2. Spike: external plugin feasibility (gate for every later group)

- [ ] 2.1 Make the host package resolve the `@deepseek-ai/dsh-*` runtime and types it needs from outside the DSH monorepo; verify it type-checks and loads in a DSH profile installed with `dsh plugin --profile <profile> add link:<checkout>/packages/bundle`
- [ ] 2.2 Register a probe tool from a child plugin of a probe preset; verify a session using that preset can call it and a session on the default preset cannot see it
- [ ] 2.3 Register a `prefix` route `/design/` with default admission; verify a normal browser tab of the DSH owner gets 200 and a request without the owner credential is refused (or, if plain navigation lacks the credential, record that and implement the short-lived token fallback from design.md)
- [ ] 2.4 Resolve a session ID to its working directory from the route handler and from a tool execution; verify with two sessions in different directories (or record the fallback from design.md)
- [ ] 2.5 Add a `tools/execute` wrapper and a `tools/post-execute` listener that attaches a fixed context string; verify the model-facing result of a direct `edit` call and of an `edit` nested in `run_code` both show it
- [ ] 2.6 Load a client contribution from the `client` package (a trivial sidebar entry); verify it appears in the DSH web GUI after installation
- [ ] 2.7 Check whether the preset registry can extend the default preset; verify by defining the probe preset both ways and record which works
- [ ] 2.8 Write the spike findings into design.md (confirmed decisions, fallbacks taken, open risks) and stop for review if any of 2.1 to 2.6 failed without a working fallback

## 3. Core: design tree, parser, and validator

- [ ] 3.1 Define the design tree types (screen, element, prop value kinds, token reference, interaction reference, source location, structural address); verify with type tests
- [ ] 3.2 Parse `.dsx` files with the JSX parser in error-recovery mode and convert accepted nodes through the allowlist walker; verify unit tests for every accepted value kind and for rejected imports, identifiers, operators, template literals, spreads, and arbitrary calls, with nothing evaluated
- [ ] 3.3 Validate components, props, enumerations, required and duplicate IDs, ID format, and the single `Screen` root against kit metadata; verify each rule has a passing and a failing test
- [ ] 3.4 Validate interaction references (overlay targets in the same screen, screen targets in the project) and responsive objects against configured breakpoints; verify with cross-screen fixture projects
- [ ] 3.5 Validate the `css` prop (scoped declarations only; reject selectors, at-rules, and `url()` outside the design folder) and report every use as a warning; verify with tests
- [ ] 3.6 Validate image sources (local path inside the design folder or placeholder; reject remote URLs); verify with tests
- [ ] 3.7 Produce diagnostics with severity, file, line, column, node ID, message, and suggestion, all in one pass and in source order, with edit-distance suggestions for components, props, values, and tokens; verify with a corpus of typical model mistakes that asserts message and suggestion
- [ ] 3.8 Implement the text projection used by `design_view` (one line per node, depth limit, subtree selection, overlays open or closed); verify with snapshot tests

## 4. Project and tokens

- [ ] 4.1 Implement design folder discovery from a working directory with the configurable folder name; verify found and absent cases
- [ ] 4.2 Parse and validate `design.json` with the documented defaults (breakpoints mobile 390, tablet 768, desktop 1280; alphabetically first screen as entry); verify defaults and type errors
- [ ] 4.3 Resolve `tokens.json` in the W3C Design Tokens subset with alias expansion, cycle detection, and type checks, and emit CSS custom properties; verify alias, broken alias, cycle, and type mismatch tests
- [ ] 4.4 Validate token references and off-token literals in style props against token types; verify unknown-token errors with nearest suggestions and off-token warnings
- [ ] 4.5 Detect duplicate screen IDs across files and kit version incompatibility with the pin; verify with fixture projects
- [ ] 4.6 Implement scaffolding (config, default tokens, one sample screen, `.gitignore` excluding `.cache/`) that refuses to overwrite; verify the scaffolded project validates with zero diagnostics and that a second run writes nothing

## 5. Component kit

- [ ] 5.1 Define the component metadata format (props, types, enumerations, token types, defaults, required ID, events, children rules, example) and a test that fails for any component missing metadata, catalog text, or an example
- [ ] 5.2 Implement tier 1 components: Screen, Stack, Grid, Box, Spacer, Divider, Header, Text, Icon, Image, Button, IconButton, Input, TextArea, Select, Checkbox, Radio, Switch, Tabs, Tab, Card, List, ListItem, Drawer, Modal; verify each renders its example with semantic roles and `data-` attributes for type and node ID
- [ ] 5.3 Implement tier 2 components: Avatar, Badge, MultiSelect, Combobox, Table, Popover, Tooltip, Toast, Menu, Breadcrumbs, Pagination, Progress, Skeleton, EmptyState; verify the same way
- [ ] 5.4 Implement built-in interactions (tab switching, select values, toggles, typing, open/close/toggle overlays with close control, backdrop, and Escape, navigate); verify with browser component tests
- [ ] 5.5 Apply token theming through CSS custom properties and responsive values per breakpoint; verify a token change and a breakpoint change in component tests
- [ ] 5.6 Implement deterministic mode (no transitions or animations, bundled fonts and icons only, frozen clock, no network); verify two renders of the same screen produce identical markup and element boxes

## 6. Renderer

- [ ] 6.1 Build the renderer app that fetches the project endpoint and renders the selected screen with the kit inside a frame of the breakpoint width; verify it renders a fixture project from a static server
- [ ] 6.2 Add preview chrome (screen list, breakpoint switcher, link-friendly URL updates); verify navigating screens and breakpoints updates the URL and the render
- [ ] 6.3 Subscribe to the events stream and refetch on each revision; verify an edit appears within one second in a browser test
- [ ] 6.4 Keep interaction state keyed by `<screen>/<node-id>` in memory and session storage and filter it on each revision; verify an open drawer stays open after an edit and a deleted drawer disappears without error
- [ ] 6.5 Render the last valid tree with an error overlay when diagnostics contain errors; verify the overlay appears on a broken save and disappears on the next valid save
- [ ] 6.6 Ship the renderer as a static bundle inside the host package with no external resource URLs; verify the built HTML and assets reference only relative paths

## 7. Host: registry, watcher, and preview route

- [ ] 7.1 Implement the project registry keyed by absolute design folder path with lazy start, shared use across sessions, and idle stop; verify two sessions in one repository share one watcher
- [ ] 7.2 Implement the debounced watcher with incremental re-parse, diagnostics, revision counter, and last-valid-tree per screen; verify revision increments and incremental parsing in tests
- [ ] 7.3 Serve the shell, assets, project, events, and files endpoints under `/design/<session>/` as designed, with real-path confinement for files; verify path traversal attempts get 404 and unknown session or screen IDs get the not-found page
- [ ] 7.4 Verify parallel previews of two sessions in different repositories in one DSH instance, each showing its own project

## 8. Agent tools

- [ ] 8.1 Implement `design_init` and `design_status` with structured results and the preview URL; verify both in tool tests, including the missing-project result of `design_status`
- [ ] 8.2 Implement `design_validate` for project, file, and screen scopes; verify deterministic ordering and identical repeated results
- [ ] 8.3 Implement `design_view` on top of the core projection; verify depth, subtree, and open-overlay options
- [ ] 8.4 Implement `design_catalog` listing and details from kit metadata with closest-name suggestions; verify for every component and for a misspelled name

## 9. Automatic validation

- [ ] 9.1 Implement the `tools/execute` fingerprint wrapper and the `tools/post-execute` listener that attaches a capped validation summary for changed design files; verify for `edit`, `write`, and a shell command that edits a screen, and that unrelated calls get nothing attached
- [ ] 9.2 Aggregate summaries from calls nested in `run_code` onto the enclosing call; verify with a program that edits a screen

## 10. Design preset

- [ ] 10.1 Define the `design` preset (default composition plus design tools and auto-validation) using the approach chosen in 2.7, with the drift test if the list is copied; verify the preset is listed and a session gets exactly the expected tools
- [ ] 10.2 Write the prompt section (workflow loop, DSL essentials, CSS policy, IDs, file layout, generated component index, pointer to `design_catalog`); verify a test enforces under 6,000 characters and no per-component prop tables

## 11. Bundle and installation

- [ ] 11.1 Compose host, client, and preset in the bundle package and document install, update, and removal with `dsh plugin` in the README; verify install and clean removal on a fresh profile, with DSH starting normally after removal
- [ ] 11.2 Report a clear activation error naming any missing extension point without breaking DSH startup; verify by simulating a missing service in a test

## 12. End-to-end verification

- [ ] 12.1 In a sample web app repository, start a `design` session, ask for a two-screen sketch with a drawer, tabs, and a select, and verify: the agent scaffolds, writes valid screens with no errors left, shares the preview URL, the preview reloads within one second on edits, and state survives reloads
- [ ] 12.2 Run `openspec validate add-design-foundation --strict` and the full test suite; verify both pass
