# Legacy canvas appearance baseline

The [snapshot](__snapshots__/legacy-appearance.spec.ts.snap) captures what Chromium measured from the archived implementation at `53137582516a8e459dd9ed75358aa1d45f1d611d`, not what the current kit is expected to produce based on its source. The [test](legacy-appearance.spec.ts) creates a temporary, synthetic kit 1.0.0 project with only a config, base tokens, and one DSX screen. It uses both the real owner route on loopback and the real deterministic browser runner, with fresh storage for each case. The owner browser advertises a dark system preference to verify that unthemed projects still use the legacy light canvas.

| Path          | Breakpoint | Viewport width | Canvas width | Default Drawer width |
| ------------- | ---------- | -------------: | -----------: | -------------------: |
| Owner preview | Desktop    |           1440 |         1280 |                360px |
| Owner preview | Mobile     |            430 |          390 |                360px |
| Deterministic | Desktop    |           1280 |         1280 |                360px |
| Deterministic | Mobile     |            390 |          390 |            343.188px |

The mobile Drawer difference is already present in the archive: its default is `min(360px, 88vw)`, where `vw` refers to the browser viewport, not the canvas. All other captured styles matched across the four cases. The focus color is recorded as native Chromium focus ring color when it matches the platform-dependent `-webkit-focus-ring-color`. Outline width, style, and offset are compared directly. The test also verifies that the only stylesheet request in the owner preview is the packaged renderer CSS, the deterministic runner makes no subresource requests, and rendering does not migrate any authored files.

## Reproduce the pinned measurement

The original capture used Node 24.21.0, pnpm 11.28.5, and Chromium Headless Shell 159.0.8154.6 on macOS arm64. The current checkout and the archive had identical lockfiles, so the archive reused the existing installed dependencies. From the repository root, with dependencies already installed and an absolute Chromium executable path:

```bash
export DSH_DESIGN_CHROMIUM_PATH=/absolute/path/to/chrome-headless-shell
set -eo pipefail
baseline=$(mktemp -d)
unset DSH_DESIGN_LEGACY_RENDERER_ASSETS
git archive 53137582516a8e459dd9ed75358aa1d45f1d611d | tar -x -C "$baseline"
cmp pnpm-lock.yaml "$baseline/pnpm-lock.yaml"
ln -s "$PWD/node_modules" "$baseline/node_modules"
node "$baseline/scripts/build.mjs"

spec=packages/renderer/tests/legacy-appearance.spec.ts
snapshot=packages/renderer/tests/__snapshots__/legacy-appearance.spec.ts.snap
cp "$spec" "$baseline/$spec"
pnpm --dir "$baseline" exec vitest run "$spec" --update
cmp "$snapshot" "$baseline/$snapshot"
```

Only the probe is copied into the archive. Its imports resolve to the archive's host, core, and kit; the archive's build produces the CSS and JavaScript served in both paths. If the lockfiles eventually differ, use dependencies from the archive's own lockfile instead of sharing the current install. Never update this snapshot by running against the candidate.

To compare a current build, run `pnpm exec vitest run packages/renderer/tests/legacy-appearance.spec.ts` without `--update`. The test defaults to the existing renderer distribution. Set `DSH_DESIGN_LEGACY_RENDERER_ASSETS` to the absolute path of an isolated current renderer distribution when sharing a worktree. The archive build above never touches the current renderer distribution or a live GUI.
