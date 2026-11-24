# Proposal

## Why

Most explorations start from an app that already exists, and redrawing it by hand is slow. At the other end, the implementing agent needs a precise, reproducible contract rather than raw renderer HTML, which is verbose and coupled to the kit.

## What Changes

- `design_capture`: the headless browser opens a running app (local development servers by default; other hosts only when explicitly allowed) and extracts a semantic snapshot, computed styles clustered into token candidates, and screenshots per breakpoint into `design/.cache/capture/`.
- Import workflow in the preset: the agent combines the capture with reading the app's routes and components, then writes tokens and screens approximated with the kit.
- Captured text and data are treated as possibly real: the guidance requires replacing them with fictitious fixtures before anything is saved as a source file, so no customer data reaches the repository.
- `design_handoff`: generates, on demand and into `design/.cache/handoff/`, a package per screen, state, and breakpoint with the DSL of the chosen variants, the semantic snapshot with layout boxes, screenshots, the token table, and the journeys as acceptance flows. Nothing generated is committed; the pinned kit version makes regeneration reproducible.
- To decide when this change is planned: whether a read-only handoff tool is also offered to non-design presets so the implementing agent can call it directly.

## Capabilities

### New Capabilities

- `design-import`: capture of a running app, allowed hosts, outputs, and the reconstruction workflow.
- `design-handoff`: handoff contents, layout per screen, state, and breakpoint, and reproducibility guarantees.

### Modified Capabilities

- `design-agent-tools`: the capture and handoff tools.
- `design-agent-preset`: import and handoff guidance, including the fictitious-data rule.

## Impact

- Relies on the headless renderer and layout snapshots from `add-design-journeys-and-checks`.
- Capturing an authenticated app needs a logged-in browser session; how that login is provided is decided when this change is planned.
