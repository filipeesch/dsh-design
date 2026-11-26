## Why

Design agents can produce valid sketches without seeing substantial fidelity errors or knowing which projection a browser check actually measured. Reviewers also need enough context to understand and try the important parts of a versioned design without rereading its authoring conversation or treating every UI state as a separate screen.

## What Changes

- Make visual evidence available earlier: show usable project selections and browser setup status, attach requested canvas images when supported, report what each check actually measured, and diagnose unavailable media independently of layout.
- Batch catalog lookups for components, DSL constructs, and composition recipes; surface meaningful edit diagnostics without clean-result chatter. Keep existing authoring tools and capabilities.
- Improve semantic styling options in the kit and add an accessible inline disclosure component with opt-in named starting points.
- Replace the flat preview navigation with a responsive screen sidebar and nested situations; keep visual variants separate. Show a durable per-screen summary and expandable details outside the canvas.
- Add an on-demand, clickable map with automatic focus around the current screen and an optional project-wide view. Derive prototype links from the design and distinguish them from documented relationships and explicit, fictitious system responses.
- Include relevant durable context and labeled relationships in handoff, but not review controls or transient session feedback.
- Keep the plugin domain-agnostic. No shared-partial syntax, general-purpose conditions, live app capture, external integrations, or business-rule simulation.

## Capabilities

### New Capabilities

### Modified Capabilities

- `design-agent-tools`: improve status, catalog, edit feedback, and check and image contracts.
- `design-agent-preset`: guide visual iteration, use of the kit, and selective prototyping.
- `design-headless-checks`: verify explicit projections and distinguish media failures from geometry.
- `design-kit`: offer opt-in semantic styling and interactive inline disclosure.
- `design-state-and-fixtures`: seed authored disclosure starting points.
- `design-project`: support optional versioned preview metadata and recoverable validation.
- `design-preview-server`: present contextual navigation, a flow map, and manual simulated outcomes.
- `design-panel`: make the same review navigation usable alongside chat and on narrow viewports.
- `design-handoff`: package relevant context and labeled relationships without review controls.

## Impact

The change touches the core project model, kit metadata and components, preview payload and renderer, embedded panel, tool and browser adapters, preset guidance, and the handoff manifest. Existing designs and valid tool calls remain supported; invalid options are rejected instead of silently ignored. Automated verification uses domain-diverse synthetic designs and captures review UI evidence outside versioned sources.
