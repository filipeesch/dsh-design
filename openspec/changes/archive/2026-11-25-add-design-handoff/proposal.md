# Proposal

## Why

Implementation agents need a precise, reproducible design contract instead of raw renderer HTML or generated application code.

## What Changes

- Add `design_handoff` to the Design preset to export chosen DSX, semantic layout, canvas screenshots, resolved tokens, and acceptance journeys to the ignored handoff cache.
- Retain the breakpoint definitions and bounded supporting sources needed to reopen the package unchanged; render evidence only for the requested matrix.
- Let coding agents consume the manifest and artifacts with their existing file tools. Do not change the default preset.

## Capabilities

### New Capabilities

- `design-handoff`: implementation contract contents, rendering inputs, and reproducible generation.

### Modified Capabilities

- `design-agent-tools`: the handoff tool contract.
- `design-agent-preset`: handoff and regeneration guidance.

## Impact

- Reuses the deterministic Chromium renderer and semantic measurement. No project schema migration or generated output in Git.
- This is the standalone handoff portion of the original combined proposal. Live application capture remains deferred in `add-design-app-capture` and does not ship here.
