# Design

## Context

The host already loads validated project snapshots, computes layout boxes through sandboxed Chromium, and renders chosen projections in a deterministic document. The Design preset has specialized tools, while the Standard preset can read ordinary files.

## Goals / Non-Goals

**Goals:** Produce a local, editable and reproducible implementation contract from the chosen design without changing versioned input.

**Non-Goals:** Live application capture, modifying application source, code generation, publishing generated artifacts, and adding tools to Standard.

## Decisions

### D1. Separate requested evidence from supporting sources

Validate the requested screen, state and breakpoint matrix before rendering and bound the number of projections. Export chosen DSX without variant wrappers, preserving stable identities, declarative interactions and named states. Retain the complete breakpoint definitions and the bounded chosen-source dependencies needed for navigation and relevant journeys. Record their supporting role in the manifest and do not render additional projections. Reject stale or invalid input. Verify that the package reopens as an editable design without manual changes.

### D2. Generate consistent evidence from one input snapshot

Use validated token and journey bytes and collect the referenced local asset bytes once. Use the same snapshot for render input and exported files; reject incompatible source changes. Use the deterministic renderer and obtain semantic boxes and the screenshot from the same committed canvas without preview UI or comment chrome. A handoff depends only on design source and its rendering environment.

### D3. Publish only complete cache packages

Use the confined ignored handoff cache, validating canonical paths and verifying staged files. Compute content-addressed identities, sorted artifact digests and a stable manifest. Exclude clock, session identity, and absolute workspace path from the logical package. Check cancellation during staging and before atomic publication. Reuse only verified packages, never overwrite distinct outputs, and leave versioned files and Git unchanged.

## Risks / Trade-offs

Large matrices require narrower selection. PNG repeatability is bounded by the compatible kit, Chromium, fonts and rendering environment. Measure repeatability across separate synthetic workspaces; do not promise pixel parity with interactive preview chrome or rendering modes.
