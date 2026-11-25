# Proposal

## Why

Pasting the repository URL into DSH installs the monorepo root rather than the Design bundle. Publish the prebuilt bundle as a GitHub Release asset so users can install it from one stable download URL without building the monorepo.

## What Changes

- Publish a stable GitHub Release with the ready-to-install `dsh-design-bundle.tgz` asset and use the same asset name in subsequent stable releases.
- Document installation from the latest asset URL in DSH, explicit upgrades, and the existing local installation options.
- Document a repeatable local build and release procedure with a package audit and a disposable DSH install check. Keep compiled files out of Git and do not require GitHub Actions.

## Capabilities

### Modified Capabilities

- `design-plugin-install`: define GitHub Release asset installation alongside local installation, and distinguish it from installation from the source repository URL.

## Impact

The install workflow, release documentation, and public GitHub Release assets change. The DSH implementation, user profiles, plugin runtime behavior, and deferred live app capture remain unchanged.
