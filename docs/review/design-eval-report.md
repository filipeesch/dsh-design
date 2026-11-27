# Design agent evaluation

## Pins and method

- Baseline: Git archive of `53137582516a8e459dd9ed75358aa1d45f1d611d`; bundle 0.1.1 SHA-256 `f2694ce77ee82d9376131c04254e473a04f7a75529281552f1df3b3d73baad58`.
- Fixed candidate: bundle 0.1.1 SHA-256 `72bd8a4e023767dc1a41e81c26a4ac38542d3e62931157fd11ae286bf4cb4335`; built from the dirty change worktree at the baseline parent after the nested schema fix. The measurements apply to that exact tarball, not subsequent repacks.
- Same real route and host: `litellm-ascent / deepseek-flash` (DeepSeek V4.1 Flash, text/image, default reasoning, recorded maxTokens 393216); native DSH executor; host `0.2.2-rc.3-a8d7867-dirty`, CLI SHA-256 `4da710b607d9f520b82f49d13d7c7c84a2cdc5ad89702bec2623a4edf3d3fcc2`; Node 24.21.0, Playwright Core 1.65.1 and Chrome 158.0.8127.37.
- [Frozen catalogue](./design-eval-catalogue.json) SHA-256 `acfa55575bb545aa4de9f27c3287399686cfe4c27ce05ed49720b97cea011c34`. Both runs used independent copies of the same archived synthetic checkout. Five real turns completed per build; the user-authored event at sequence 9 matched the frozen text in each. Expectations and DOM checks stayed in the grader. See [reproduction](./design-eval.md).

## Before and after

First attempt is the first operation that directly targets the requested evidence or artifact, not preliminary status. Static View without a breakpoint is a weak first attempt for a measurement. These are single-run observations, not average performance claims.

| Request        | First attempt (baseline → candidate)                  | Model round trips | Tool calls | Result text bytes | Attached image bytes | Independently verified                                                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------- | ----------------: | ---------: | ----------------: | -------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lookup         | Correct → correct                                     |           19 → 25 |    21 → 32 |   17,832 → 47,538 |      15,128 → 15,128 | Both supplied mobile checkout links selecting the open drawer; fresh 390 px preview shows Order review. Links require access to the local owner preview.                                                                                         |
| Question       | Weak (static View first) → correct (focused geometry) |             5 → 4 |      5 → 4 |     4,145 → 2,766 |                0 → 0 | Both gave 342 × 46 CSS px; Chromium confirmed both dimensions are at least 44.                                                                                                                                                                   |
| Cross-source   | Correct → correct                                     |            10 → 8 |    24 → 14 |   16,589 → 16,978 |           99,264 → 0 | Both used the 10-step mobile journey and gave evidence tables; 390 px confirmation loads independently.                                                                                                                                          |
| Create simple  | Correct → correct                                     |             5 → 6 |      6 → 6 |     4,630 → 4,935 |      26,234 → 26,234 | Same 390 × 520 PNG bytes: expanded Price details, visibly highlighted breakdown, $42 total.                                                                                                                                                      |
| Create complex | Correct initial edit → correct initial edit           |           33 → 46 |    46 → 58 |   80,961 → 29,673 |     42,516 → 136,461 | Both started collapsed and could reveal the note and navigate using the disclosure’s own Back to catalog button. Both changed only the confirmation screen, journey and preview metadata. Candidate also restyled the existing confirmation CTA. |

### Evidence locators

Sequence numbers refer to each request’s native event log (B = baseline; C = candidate).

- **Lookup:** B35/C44 first View selects checkout, mobile, review-open. B149/C205 supply matching preview coordinates; C205 says it “seeds the **Order review** drawer already open.” No source changed. Both took an unrequested screenshot.
- **Question:** B22 started with static `{"screen":"checkout"}`, then supplied an actual measurement at B29. C24 used focused geometry with `"nodes":["place-order"],"cases":[{"breakpoint":"mobile"}]`. B38/C33 give 342 and 46; C33 says “both dimensions pass the 44 px touch target.” No source changed.
- **Cross-source:** B46/C33 call the intended `catalog-to-confirmation` journey. B95 says “The journey passed 10/10 steps”; C69 says “10/10 steps passed.” Both included extra lint and journey findings. No source changed.
- **Create simple:** B31/C29 select `prices-open`, `mobile` and highlight `price-breakdown`. B41/C46 report the artifact paths. The visually inspected PNG is identical on both: SHA-256 `200e14519036e2ca96ddaec27c1c9d153a40b3cb34158f91c931d844c3bbedf1`. No source changed.
- **Create complex:** B61/C41 contain `defaultOpen={false}`, the requested note and `navigate("catalog")`. First validation B67/C47 says “No diagnostics”; B77/C124 show passing authored journeys. Final replies B222/C299 report a working phone interaction. The candidate browser script initially stopped after proving the collapsed default because its navigation selector used the wrong ancestor. A separate same-bundle browser recheck verified expansion and navigation using `aria-controls`; the reusable runner now uses that locator.

Repeated extra inspection and screenshots affected lookup, cross-source and complex authoring. The candidate improved the measured geometry workflow, but lookup and authoring took more model round trips. No additional prompt tuning was done in this evaluation.

## Installed deterministic gates

- Real native dispatch captured registered schemas, canonical values, and ordinary output. Design registered 11 baseline tools and 10 candidate tools; Standard registered zero Design tools and invoking status there was refused. A full ten-step journey, mobile geometry, and screenshot confinement passed on both.
- Candidate `cases.items.required` contains `["breakpoint"]`; no boolean `required` leaks into the property. Ordered geometry cases distinguish hidden, visible, and absent without images. Invalid breakpoint returns `invalid-selection` and leaves browser readiness `unverified`.
- Real Chromium returned ordinary mobile lint (three tap-target warnings) and a valid failed journey (only step one ran, with `ok:false`, expected hidden, observed visible, and a snapshot). Neither was a dispatcher error.
- Separate profiles returned `chromium-missing` and `timeout` (1 ms browser budget). In-flight native batch cancellation surfaced as `ABORTED` with “tool call aborted”, distinct from all other outcomes. If a future native pipeline preserves the tool’s canonical `cancelled` value, the check accepts that instead.

## Excluded attempts and evidence

An early candidate tarball (SHA-256 `e511c3cb1931423d99657147985036b71c5df33675e87fa930aff1d709051481`) was rejected before model output: four submitted prompts saw HTTP 400 `INVALID_REQUEST` because the model route rejected `design_view` with “true is not of type array.” The captured request schema had a boolean `breakpoint.required`. The schema was fixed before the measured candidate round. A first lookup GUI race and earlier baseline instrumentation issues were also excluded; no historical conversations were used as measurements.

| Private evidence                                | Scratch root                           |
| ----------------------------------------------- | -------------------------------------- |
| Frozen baseline                                 | `/tmp/design-baseline-final.Y5hjES`    |
| Fixed candidate                                 | `/tmp/design-candidate-fixed.6pRtey`   |
| Independent authoring preview recheck           | `/tmp/design-authoring-recheck.bStmiW` |
| Installed lint, failed journey and cancellation | `/tmp/design-outcomes-final.3yIn3B`    |
| Installed short deadline                        | `/tmp/design-outcomes-short.LiyeiK`    |
| Installed missing Chromium                      | `/tmp/design-geometry-missing.AVZXLX`  |

Raw captures, source hashes, model usage, and durable session logs stay in private scratch. The active GUI profile on port 3080 was not modified. No credentials were printed or stored in the repository.
