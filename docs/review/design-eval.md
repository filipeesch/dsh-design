# Installed Design evaluation

This review has two independent lanes: deterministic checks through the real DSH
native tool dispatcher, and five frozen prompts through the real DSH Web GUI.
The latter uses the same synthetic checkout on both builds. It does not require
candidate-only themes, focused geometry, intent search, new controls, or a
handoff export. Those features belong in deterministic tests. For the standalone
[status, validation, and query regression](./design-installed-dispatch.md), no
model route or Chromium executable is required.

## Reproduce

Use Node 24+, an already built DSH checkout, the project's existing dependencies,
and an existing Chromium executable. Run from the design repository; keep
operator configuration and raw evidence outside it. Do not use port 3080.

Build the baseline in a private archive; never check out or reset the shared tree:

```sh
umask 077
BASE=$(mktemp -d /tmp/design-source.XXXXXX)
git archive 53137582516a8e459dd9ed75358aa1d45f1d611d | tar -x -C "$BASE"
ln -s "$PWD/node_modules" "$BASE/node_modules"
(cd "$BASE" && node scripts/build.mjs && node scripts/pack.mjs)
```

In a terminal, launch either lane using a **new** scratch directory and port.
For the candidate, use a disjoint filename for its packed tarball so a rebuild
cannot overwrite the evidence. Supply the candidate source revision (or the
parent revision if the build is dirty) and identify dirty source separately in
the report; the tarball SHA-256 is the artifact pin.

```sh
export DESIGN_EVAL_ROOT=$(mktemp -d /tmp/design-review.XXXXXX)
export DESIGN_EVAL_LANE=baseline  # or candidate
export DESIGN_EVAL_SOURCE=53137582516a8e459dd9ed75358aa1d45f1d611d
export DESIGN_EVAL_BUNDLE="$BASE/dist/filipeesch-dsh-design-bundle-0.1.1.tgz"
export DESIGN_EVAL_PORT=3091  # use another free loopback port for each host
export DSH_REVIEW_CLI=/path/to/dsh/apps/cli/lib/bin.js
export DSH_DESIGN_CHROMIUM_PATH=/path/to/chrome
node docs/review/design-eval-host.mjs
```

This stages the packed package in the isolated profile using already built
host peers and existing Playwright. It does not install dependencies or use the
active profile's package tree. Check `dispatch.json` for scoped schemas,
canonical values and ordinary model-facing output. The candidate checks the
nested JSON Schema, invalid breakpoint preflight, focused ordered results,
visible/hidden/absent distinction, and no image in geometry output. For a
separate candidate-only negative pass, start a new scratch root with
`DESIGN_EVAL_NO_CHROMIUM=1` and point `DSH_DESIGN_CHROMIUM_PATH` to a nonexistent
executable to verify `chromium-missing` without substituting a fake browser.
Another isolated deterministic candidate pass can use
`DESIGN_EVAL_CHECK_TIMEOUT=1` for a 1 ms browser budget and `timeout` result.
The normal candidate pass checks ordinary lint findings, a failed assertion
with a snapshot, and in-flight cancellation.

For the **real-model lane**, additionally set `DESIGN_EVAL_ROUTE_PATCH` to a
private operator-supplied DSH patch; its `agent-default-model` selection must
match `DESIGN_EVAL_PROVIDER` and `DESIGN_EVAL_MODEL`. Use the same real provider,
model, reasoning setting, executor and overlay both times. The measured route
is `litellm-ascent / deepseek-flash` (DeepSeek V4.1 Flash, text and image).
Disable `session-title-llm` in the overlay so title generation is not a second
model workload. Use an authorized credential only in disposable host auth
authorized for this route. Do not include credential values in arguments,
patches under version control, logs, or reports. Treat the owner URL in
`host.log` as a secret and do not print it.

When the isolated host writes `sessions.json`, run (with the same root and
Chromium path in a second terminal):

```sh
DESIGN_EVAL_TIMEOUT_MS=300000 node docs/review/design-eval-run.mjs
```

The runner creates a clean Design conversation per request and submits only
`text`. It checks the committed user-authored event for exact equality; DSH's
own runtime-context, time, and skill-catalog messages are not user text. Stops
or unanswered tool pauses are recorded as incomplete, never approved by the
driver. `DESIGN_EVAL_ONLY` can isolate an unstarted case for troubleshooting,
but a complete re-run uses a new scratch root and all five cases. Stop only the
isolated host when done.

## Read the evidence

Each request has private source hashes, native committed events, a durability
checkpoint, model call and token usage metrics, tool calls, and browser
captures. SSE payload chunks are best-effort, never a substitute for committed
events. Check `request/header` for the actual model config and registered
schemas, `tool/call` for exact arguments and `tool/result` for delivered
content, then the final `assistant/message`. Match call IDs; count failed
`assistant/attempt` events as requests as well as committed assistant messages.
Tool-result volume is UTF-8 bytes of model-visible text; attached-image bytes
are separate, not a token estimate. Compare model accounting only where logged.
`node docs/review/design-eval-compare.mjs <baseline-scratch> <candidate-scratch>`
reads the saved metrics without dumping raw transcripts.

Score the first relevant attempt, not a correct retry; grade missing evidence
as incomplete. Independently compare the returned selection, dimensions,
journey outcome, PNG, or published source against the frozen expectation in
[design-eval-catalogue.json](./design-eval-catalogue.json). The browser probe of
a known-good expected route proves the fixture can render; it does not prove
that the model actually supplied that route. A PNG header proves dimensions,
not the highlighted content: inspect the actual artifact before grading. A
real turn can complete even when an independent preview assertion fails; report
these two outcomes separately. Keep raw files (including transcripts and GUI
images) private and include only reviewed excerpts and hashes in the report.
