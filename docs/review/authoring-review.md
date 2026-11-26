# Installed authoring and preview review

This review installs the packed Design bundle into a new DSH profile and copies
`examples/document-outcomes/design` into a disposable workspace. It does not touch
the existing DSH web server or profile. Only the model metadata is supplied by a
local fixture; tool dispatch, native rendering, attachment storage, browser
capture, and the browser UI are real. No model or provider request is sent.

## Run the review

From the repository root, with dependencies installed, a built DSH CLI, and a
Playwright-managed Chromium headless shell available:

```sh
export DSH_REVIEW_CLI='/absolute/path/to/dsh/apps/cli/lib/bin.js'
export DSH_DESIGN_CHROMIUM_PATH='/absolute/path/to/chrome-headless-shell'
pnpm run pack:bundle
bundle="$PWD/dist/filipeesch-dsh-design-bundle-0.1.1.tgz"

umask 077
review=$(mktemp -d /tmp/dsh-authoring-review.XXXXXX)
export DSH_HOME="$review/home"
export REVIEW_CWD="$review/workspace"
export REVIEW_OUTPUT="$review/evidence"
export REVIEW_STARTUP_LOG="$review/startup.private.log"
mkdir -p "$DSH_HOME" "$REVIEW_CWD" "$REVIEW_OUTPUT"
cp -R examples/document-outcomes/design "$REVIEW_CWD/design"
shasum -a 256 "$bundle" > "$REVIEW_OUTPUT/bundle.sha256"

node "$DSH_REVIEW_CLI" --profile review --from-default-profile web --dump-config >/dev/null
node "$DSH_REVIEW_CLI" plugin --profile review add --offline "$bundle"
printf '%s\n' '- insert:' '    - id: design-authoring-review-session' \
  "      name: $PWD/docs/review/authoring-review-session.mjs" > "$review/authoring.patch.yml"

node "$DSH_REVIEW_CLI" --profile review --patch "$review/authoring.patch.yml" \
  --host 127.0.0.1 --port 0 --no-open > "$REVIEW_STARTUP_LOG" 2>&1 &
review_pid=$!
```

Use a new shell or subshell for this setup so the temporary environment does not
carry over to other work. The offline install expects Playwright's npm package in the
local pnpm store. Run without `--offline` if you explicitly intend to fetch any
missing dependency.

Once the server has written `native-tool-result.json` in `$REVIEW_OUTPUT`, run:

```sh
node docs/review/authoring-check.mjs
kill "$review_pid"
wait "$review_pid" 2>/dev/null || true
```

The browser harness reads the owner entry URL directly from the private startup
log. Do not publish the log; it contains a disposable owner token. On failure,
inspect the relevant error locally, and stop the test process before retrying.
If you rerun, use a fresh temporary directory. You can delete the private log
after confirming the process stopped, and remove the entire temporary directory
when its evidence is no longer needed.

## Expected evidence

- `native-tool-result.json`: native `design_screenshot` for the same mobile review
  state and highlighted node in two Design-preset sessions. The image-capable
  route returns text and a readable DSH image attachment; the text-only route
  returns the saved PNG path with a human-readable fallback, no image block.
  Both modes return the same cache path and PNG digest.
- `desktop-preview.png`: the entry screen at its 1280px canvas width, with
  context and grouped screen navigation.
- `narrow-embedded-navigator.png`: the keyboard-opened navigator inside the
  real DSH Design panel at 390px, with authored situations and retained mobile
  breakpoint on navigation.
- `focused-map.png`: the waiting screen's focused map with labeled prototype,
  manual simulation, and illustrative connections.
- `simulated-correction.png`: selecting Correction request opens the named
  correction state and its Editorial note without advancing any real workflow.
- `browser-result.json`: structured checks and capture dimensions.
