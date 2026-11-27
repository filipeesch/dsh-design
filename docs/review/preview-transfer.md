# Design preview transfer comparison

This harness compares the installed 0.1.3 baseline with a packed candidate on
separate disposable DSH Web profiles. It opens the native Design panel, then
clicks **Open in tab** in the same Chromium context. It does not run against
port 3080 or write to the live profile.

## Reproduce

Use Node 24+, this repository's installed dependencies, an already-built DSH
checkout, and a sandbox-capable Playwright Chromium. To override the managed
browser, set `DSH_DESIGN_CHROMIUM_PATH` to its absolute executable path. Run from
this repository root. Point `BASELINE` to the installed 0.1.3 bundle directory
and `CANDIDATE` to the immutable candidate tarball from `pnpm run pack:bundle`.
Use the same free loopback port for both runs, sequentially.

```bash
export DSH_REVIEW_CLI=/path/to/dsh/apps/cli/lib/bin.js
export PREVIEW_TRANSFER_PORT=3797
export PREVIEW_TRANSFER_SCREENSHOTS=1 # optional
BASELINE=/path/to/installed/node_modules/@filipeesch/dsh-design-bundle
CANDIDATE=/path/to/packed-candidate.tgz
baseline_root=$(mktemp -d /tmp/preview-baseline.XXXXXX)
candidate_root=$(mktemp -d /tmp/preview-candidate.XXXXXX)

run_lane() (
  export PREVIEW_TRANSFER_ROOT="$1" PREVIEW_TRANSFER_BUNDLE="$2"
  node docs/review/preview-transfer-host.mjs &
  launcher=$!
  trap 'kill "$launcher" 2>/dev/null; wait "$launcher" 2>/dev/null' EXIT
  for i in {1..60}; do
    [ -f "$PREVIEW_TRANSFER_ROOT/ready" ] && break
    sleep .2
  done
  node docs/review/preview-transfer-check.mjs
)

run_lane "$baseline_root" "$BASELINE" &&
  run_lane "$candidate_root" "$CANDIDATE" &&
  node docs/review/preview-transfer-check.mjs --compare \
    "$baseline_root/measurement.json" "$candidate_root/measurement.json"
```

The launcher uses a private scratch directory and scrubs inherited credentials.
It seeds one setup message without a configured model so the session is listed,
then waits for the agent to stop running. No prompts are sent during the test.
Keep `host.log` private: it contains the temporary owner link. The report and
optional desktop-panel, desktop-tab, and mobile-tab screenshots stay in the
scratch directory.

## Measurement and limits

The fixture has 30 synthetic queue screens, each with 36 records, two navigator
groups, and a named situation. The harness verifies the same authored bytes
and bundle/host provenance. Each lane starts with a fresh Chromium context at
1440 × 900 and preserves default HTTP cache behavior. The panel opens first,
so shared renderer assets can be cached in the tab. No request interception is
used. Both lanes verify the same launch URL, all 30 screen links, navigation to
Queue 30, and its Flow map situation without a document reload.

The cutoff is the first insertion of the expected canvas heading with a
nonzero layout width, observed inside the popup, independently of the test
runner's polling interval. The metric sums Resource Timing encoded body bytes
for same-session preview responses completed by that mark; cache hits count as
zero. It excludes headers, unrelated GUI traffic, and unfinished responses
(including the baseline's open event stream). It is not a first-paint latency,
cold-cache, maximum-concurrency, or system-wide performance benchmark.

## Recorded run

Loopback HTTP/1.1 on port 3797, Chromium 159.0.8154.6, Playwright 1.65.1,
identical fixture of 417,260 source bytes (SHA-256
`703ac014d95959163b777ad12d483f514737cbe2d54e29b3b1d54ace64dbfeb7`).

| Metric                                           |    Installed 0.1.3 | Packed candidate (manifest 0.1.1) |
| ------------------------------------------------ | -----------------: | --------------------------------: |
| Host build ID                                    | `4c1ea20d52bfed20` |                `e6e4a35e2a1cc419` |
| Preview response body bytes through first canvas |            467,997 |                            17,906 |
| Project response body bytes, encoded             |            467,188 |                            17,106 |
| Project response body bytes, decoded             |          5,138,483 |                           181,263 |

The comparison gate passed: **96.17% fewer transferred preview body bytes**.
Both builds passed navigation. The immutable candidate archive SHA-256 was
`dac2788f08db58a91710553072f05e6eedeef19a5100512433448db1d4c26944`.

Separately, the [Chromium connection regression](../../packages/renderer/tests/preview-concurrency.spec.ts)
uses a same-origin panel shell and real preview routes on a local HTTP/1.1
server. It tests six preview documents, a control request, short revision
responses, a foreground edit within one second, a warmed legacy asset cache,
and recovery after preview inactivity and an invalid edit. Where
headless Chromium reports both tabs visible, it emulates only the visibility
signal, not actual OS suspension or throttling. Neither test establishes a fix
for system-wide slowdown.
