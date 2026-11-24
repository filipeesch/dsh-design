# Proposal

## Why

Agents can implement UI quickly, but there is no fast, agent-native way to explore an app's design before implementing it: Figma is built for humans, and throwaway HTML mockups are slow to edit, noisy to diff, and not a contract another agent can implement from. This change lays the foundation of a DeepSeek Harness (DSH) plugin where an agent sketches a faithful, clickable design of a responsive web app in a compact declarative DSL, saved and versioned inside the app's own repository.

## What Changes

- New external DSH plugin, developed in this repository and installed into a DSH profile with `dsh plugin`, starting with a spike that proves an external package can register tools, a web route, a post-tool hook, a preset, and a client UI contribution.
- New design project convention inside the target app repository: a `design/` folder with a config file (kit version pin, breakpoints), design tokens, and one screen per `.dsx` file; derived and throwaway files live in a git-ignored cache folder.
- New restricted JSX-style DSL (no JavaScript): components with props and children, mandatory stable IDs on addressable nodes, style props that accept design tokens, a visible raw-CSS escape hatch, and basic interaction references (open/close an overlay, switch a tab, navigate to another screen).
- New component kit themed by design tokens covering standard web UI: layout primitives, text, buttons and their variants, inputs, selects, checkboxes and switches, tabs, cards, lists, drawers, modals, popovers, tooltips, and toasts, with a deterministic rendering mode.
- New per-session preview at `/design/<session>/` on the DSH web server, restricted to the DSH owner, supporting several sessions in parallel and live reload on every file change without a build step, preserving UI state across reloads.
- New agent tools: project scaffolding, status (including the preview URL), validation with precise errors, a text projection of a screen, and an on-demand kit catalog.
- New automatic validation: after any tool call that changed design files, the validation result is attached to that tool's result, so the agent sees errors without an extra call.
- New `design` agent preset composing the design tools, a compact DSL guide in the system prompt, and the editing and verification workflow.

Out of scope here and planned as follow-up changes: declared screen state, fixtures and user journeys with headless checks, lint and screenshots (`add-design-journeys-and-checks`); the DSH GUI panel and pinned comments (`add-design-panel-and-comments`); side-by-side variants (`add-design-variants`); importing an existing app and the implementer handoff (`add-design-import-and-handoff`). Generating application code from the design is a non-goal.

## Capabilities

### New Capabilities

- `design-plugin-install`: packaging of the plugin as external DSH packages, installation into a profile, and activation of its host, client, and preset parts.
- `design-project`: the design folder convention in the app repository, its config and tokens files, discovery from the session's working directory, scaffolding, and git-ignored derived files.
- `design-dsl`: the restricted JSX-style syntax, the allowed constructs, IDs, token-based style props, the CSS escape hatch, interaction references, and validation diagnostics.
- `design-kit`: the base component set, its props and variants, token theming, viewport breakpoints, and deterministic rendering.
- `design-preview-server`: the per-session preview route, access control, parallel sessions, live reload with state preservation, and error display.
- `design-agent-tools`: the model-facing tools (init, status, validate, view, catalog) and automatic validation after edits.
- `design-agent-preset`: the `design` preset, its tool set, its prompt guidance, and the expected agent workflow.

### Modified Capabilities

(none; the project has no existing specs)

## Impact

- New pnpm workspace in this repository with packages for the DSL core (shared by host and browser), the kit, the browser renderer, the DSH host plugin, the DSH client plugin placeholder, and the preset.
- Depends on DSH extension points: `ctx.tools.register`, `ctx.webServer.register` (prefix routes, owner admission), `tools/post-execute`, the agent preset registry, and client plugin loading for external packages. The spike may show that an external package cannot reach some of them; the design then adjusts before the remaining tasks start.
- Writes into target app repositories only under the design folder chosen by the user (scaffold, config, tokens, screens, cache ignore file).
- The preview is served only on the local DSH web server and requires the DSH owner session; nothing is deployed elsewhere.
