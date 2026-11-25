# Spec Delta

## MODIFIED Requirements

### Requirement: Installable as an external DSH plugin

The plugin SHALL be installable into a DSH profile from a prebuilt GitHub Release asset or from a built local checkout or local bundle, without modifying the DSH source tree. Installation instructions SHALL distinguish the release asset from the source repository URL, which selects the monorepo root rather than the plugin bundle.

#### Scenario: Install from a local checkout
- **WHEN** the user runs `dsh plugin --profile <profile> add <path-to-plugin-package>` and restarts DSH with that profile
- **THEN** the Design preset appears in preset selection and the `/design/` preview route answers on the DSH web server

#### Scenario: Install does not touch DSH sources
- **WHEN** the plugin is installed
- **THEN** no file inside the DSH installation or checkout is created or modified by the installation

## ADDED Requirements

### Requirement: Install from the latest stable release asset

Every stable GitHub Release SHALL publish the prebuilt installable bundle under the same asset name, `dsh-design-bundle.tgz`. The public `/releases/latest/download/dsh-design-bundle.tgz` URL SHALL resolve to that bundle on the current latest stable release. Users SHALL NOT need to clone the source tree, run the plugin build, or approve plugin build scripts to install this asset.

#### Scenario: Install from the stable URL in DSH
- **WHEN** a user installs the latest release asset URL through DSH, enables the bundle if offered, and restarts the profile if prompted
- **THEN** DSH installs `@filipeesch/dsh-design-bundle`, lists the Design preset, and serves a preview for a Design session with a valid local design project

#### Scenario: Choose a release or explicitly upgrade
- **WHEN** a user needs a fixed version or wants to move an installed plugin to a later release
- **THEN** the documentation provides the version-specific asset URL format and an explicit reinstall procedure, and does not promise automatic upgrades from the latest URL
