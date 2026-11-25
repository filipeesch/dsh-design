# design-plugin-install Specification

## Purpose

Defines how the design plugin is packaged outside the DSH source tree, installed into a DSH profile, and activated, so it can evolve on its own release cycle.

## Requirements

### Requirement: Installable as an external DSH plugin
The plugin SHALL be installable into a DSH profile through `dsh plugin` from this repository (a local checkout path or the git repository) without modifying the DSH source tree.

#### Scenario: Install from a local checkout
- **WHEN** the user runs `dsh plugin --profile <profile> add <path-to-plugin-package>` and restarts DSH with that profile
- **THEN** the `design` preset appears in the preset selection and the `/design/` preview route answers on the DSH web server

#### Scenario: Install does not touch DSH sources
- **WHEN** the plugin is installed
- **THEN** no file inside the DSH installation or checkout is created or modified by the installation

### Requirement: Clean removal
Removing the plugin from a profile SHALL remove its preset, tools, routes, and client contributions, and DSH SHALL start normally afterwards.

#### Scenario: Uninstall
- **WHEN** the user removes the plugin package from the profile and restarts DSH
- **THEN** DSH starts without errors, the `design` preset is no longer listed, and `/design/` returns 404

### Requirement: Clear activation failure
When an extension point the plugin requires is unavailable in the running DSH, the plugin MUST fail to activate with an error that names the missing capability, and MUST NOT prevent the rest of DSH from starting.

#### Scenario: Missing extension point
- **WHEN** the plugin starts in a DSH build that does not provide a required extension point
- **THEN** the DSH log shows an activation error naming that extension point, and other sessions and plugins keep working
