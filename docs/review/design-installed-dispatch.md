# Installed dispatcher regression: status, validation, and query

This is the task 4.1 regression for a **packed candidate bundle**. It uses the
real DSH Web host, Design and Standard preset registrations, and native tool
dispatcher. The calls are scripted, so it does not use a model, a model route,
credentials, a browser window, or a Chromium installation. Use an isolated DSH
profile only. Never use port 3080.

## Prepare the packages

Use Node 24+, a built DSH checkout and this repository's existing dependencies.
Set `DESIGN_EVAL_BUNDLE` to an immutable candidate tarball. Obtain a second
private package built with a different release version and embedded host/tools
IDs, but with the same kit and tool contract. Do not use a baseline predating
build metadata and do not merely edit a packed manifest. For example, from the
repository root, build the replacement in a private copy of the candidate's
source (including uncommitted production source if that is what was packed):

```sh
umask 077
replacement_source=$(mktemp -d /tmp/design-status-source.XXXXXX)
rsync -a --exclude node_modules --exclude lib --exclude dist \
  packages scripts pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json "$replacement_source/"
ln -s "$PWD/node_modules" "$replacement_source/node_modules"
for dir in packages/*; do
  if [ -d "$dir/node_modules" ]; then
    ln -s "$PWD/$dir/node_modules" "$replacement_source/$dir/node_modules"
  fi
done
node -e 'const fs=require("node:fs"), p=process.argv[1], pkg=JSON.parse(fs.readFileSync(p));
  pkg.version="0.1.2-status-regression"; fs.writeFileSync(p, JSON.stringify(pkg, null, 2)+"\n");' \
  "$replacement_source/packages/bundle/package.json"
(cd "$replacement_source" && node scripts/build.mjs --only renderer && node scripts/build.mjs --only bundle && node scripts/pack.mjs)
export DESIGN_EVAL_REPLACEMENT="$replacement_source/dist/filipeesch-dsh-design-bundle-0.1.2-status-regression.tgz"
```

Use a different test release if the candidate already has that version. The
build must embed a real alternate identity in both compiled modules. The
launcher checks these identities and records the tarball and module SHA-256s.

## Run both modes

From the repository root, set these values. For dirty builds, use the parent
Git revision in `DESIGN_EVAL_SOURCE` and identify the dirty build by its
recorded tarball hash. Choose a free loopback port for each run.

```sh
export DSH_REVIEW_CLI=/path/to/dsh/apps/cli/lib/bin.js
export DESIGN_EVAL_BUNDLE=/absolute/path/to/pinned-candidate.tgz
export DESIGN_EVAL_LANE=candidate DESIGN_EVAL_SOURCE=$(git rev-parse HEAD)
unset DESIGN_EVAL_ROUTE_PATCH DESIGN_EVAL_NO_CHROMIUM DESIGN_EVAL_CHECK_TIMEOUT

export DESIGN_EVAL_STATUS=swap DESIGN_EVAL_PORT=3791
export DESIGN_EVAL_ROOT=$(mktemp -d /tmp/design-status-swap.XXXXXX)
node docs/review/design-eval-host.mjs
```

From a second shell, verify `dispatch.json` has `"ok": true`, then stop the
isolated host with Ctrl-C in its own terminal. Repeat with
`DESIGN_EVAL_STATUS=mixed`, a new empty private scratch root, and a different
free port. The launcher supplies a deliberately missing Chromium path; do not
point it at a real browser. The existing [broader installed evaluation](./design-eval.md)
is separate and covers actual Chromium results.

- **Swap:** dispatch Status in the loaded Design session; replace the entire
  on-disk installed package in the private profile; compare the second Status
  result in the same session, including exact model-facing text, to the first.
  The candidate Host/Tools remain running; the recorded version and hashes on
  disk must match the distinct replacement. The same session then runs the
  validation and static query matrix, and Status still reports `unverified`.
- **Mixed:** start a fresh original Host with the actual replacement Tools
  bytes installed before loading. Status must distinguish the two running
  IDs/releases in the canonical value and ordinary output. The project pin
  `^1.0.0` and installed kit `1.0.0` must remain separate from the releases.

`provenance.json` records expected packed identities and hashes.
`dispatch.json` records the checked on-disk hashes, registered Design and
Standard schemas, each call's canonical value or native error, and ordinary
content. Neither the Standard session nor an invalid query may produce
successful Design output. Validation selection errors must be coded values
(`invalid-selection`); malformed native inputs must use the error envelope
instead of returning a clean result. The shared-fixture error must report
`layouts/dispatch-shell.dsx:3:5` in file, consumer screen, and project scope,
but not in an unrelated screen. Keep the evidence private; do not publish the
owner URL from `host.log`.

## Recorded run

Candidate tarball SHA-256:
`8cac5aaccc066f269792eb0cc7574456855b466f815c75f1d3b7e0640d166e12`.
Replacement tarball SHA-256:
`8f4f09bc3847136aa33aaeb1dfdf759092094a2efd433f5db5b8b1f88fc7933e`.

- Swap: the installed manifest and both compiled modules changed from
  `0.1.1` / `39fcb915d4cc8570` to `0.1.2-status-regression` / `3cda8c6d772e41b9`.
  The loaded session still reported `Active plugin build: 0.1.1 (39fcb915d4cc8570)`,
  with identical canonical Status and ordinary output before and after the swap.
  Readiness stayed `unverified` after the full static input matrix. Six calls
  returned coded validation failures and ten rejected invalid input through the
  native error envelope. The valid alternate query returned only the requested
  alternate node. The shared diagnostic retained `fixture-missing` at
  `layouts/dispatch-shell.dsx:3:5`.
- Mixed: ordinary output also said
  `Tools build differs from host: 0.1.2-status-regression (3cda8c6d772e41b9)`;
  canonical output identified both builds separately, alongside kit pin
  `^1.0.0`, installed kit `1.0.0`, and unverified readiness. Standard had no
  Design tool registrations in either run.

Private evidence roots (each contains `dispatch.json` and `provenance.json`):

| Lane                          | Evidence root                              |
| ----------------------------- | ------------------------------------------ |
| Status swap                   | `/tmp/design-native-repack-swap.40w3uL`    |
| Status mixed                  | `/tmp/design-native-repack-mixed.CdSpee`   |
| Normal Chromium               | `/tmp/design-native-repack-normal.IgeJPC`  |
| Missing Chromium              | `/tmp/design-native-repack-missing.wmzQCW` |
| Chromium timeout              | `/tmp/design-native-repack-timeout.IWj1cN` |
| Frozen baseline compatibility | `/tmp/design-final-baseline.N1xwsy`        |
