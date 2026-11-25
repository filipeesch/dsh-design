# Design

## Context

The workspace root is source-only. A plain GitHub repository URL installs that root rather than the packaged Design plugin. The verified local tarball already contains the compiled plugin, DSH patch, renderer, fonts, and client modules. GitHub Releases can serve the same artifact under a stable URL without putting generated files on the default branch.

## Goals / Non-Goals

- Give users one public download URL they can paste into DSH.
- Preserve built local and linked developer installation options.
- Do not change DSH, user profiles, the plugin runtime, or the deferred live capture scope.
- Do not require GitHub Actions, a registry publication, or automatic updates.

## Decisions

### Package the existing bundle, not the repository root

Use the existing build and packing pipeline. Stage a copy of the inspected bundle as `dsh-design-bundle.tgz` and generate its SHA-256 checksum. Keep both files outside tracked source. Check the bundle identity, version, activation patch, compiled assets, and absence of the deferred live capture runtime. First verify the local bundle in a disposable DSH profile. This avoids a monorepo build on the installer machine.

### Publish versioned releases and retain a stable download URL

Create the first stable release as `v0.1.0`, matching the bundle manifest, against a verified, pushed source commit. Upload the exact inspected bundle and checksum before making the release latest. Verify the public download without credentials and compare the bytes to the published checksum. Use the same asset name for each later stable version. Keep a version-specific URL available for pinned installs; do not overwrite an existing versioned asset.

### Verify the user-facing installation path

In a fresh loopback-only DSH web profile with separate state, submit the exact latest URL through the existing installer. Verify the resolved package identity, Design preset, and preview of a synthetic local project. Stop the temporary server afterwards. Keep the real profile and running DSH instance untouched.

## Risks / Trade-offs

- The latest URL is mutable and package managers may reuse a cached resolution. Document explicit reinstall and version-pinned URLs for reproducibility.
- A missing asset would break the stable URL. Check the uploaded name and checksum before promotion, then verify the public route again.
- Publishing locally avoids an Actions dependency but requires an authenticated maintainer. Document the release steps and never include credentials in the published assets.

## Rollout

Test the candidate locally, then create and verify the stable release from the already-pushed source commit. After testing the public installer route, push the distribution docs, release procedure, and archived change together. If the public route fails, do not advertise it as working; retain the built local installation route and correct the release through a new version if the published artifact itself needs replacement.
