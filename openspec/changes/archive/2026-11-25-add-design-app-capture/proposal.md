# Proposal

## Why

Live development-app capture was investigated, but the tested Chromium runtimes did not start with their sandbox enabled in the dedicated Colima environment. The owner chose to skip the remaining acceptance run and close this delivery without live capture. Skipping the run is not evidence of runtime support.

## What Changes

- Keep the unverified capture candidate outside the production bundle and all shipped presets.
- Record the release gate for a future capture change. Preview and handoff continue to use local design sources and remain independent of any live capture service.

## Capabilities

### Modified Capabilities

- `design-agent-tools`: document the release gate for live app capture and verify that the current bundle does not expose it.

## Impact

The capture tool, guidance, configuration, worker, and service files are not delivered. No new import capability is added. The original draft is retained locally for future work.
