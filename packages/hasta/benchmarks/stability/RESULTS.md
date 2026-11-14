# Historical callback-only stability results

This report records the observation-freshness-only checkpoint before the numerical filter update. At that checkpoint the public API and Kalman implementation were unchanged. The fixed policy produced 11 fewer wrong first actions and three fewer useful first actions; motion forecasts were identical to the frozen baseline. See [the later filter evaluation](FILTER-RESULTS.md) for the subsequent numerical change.

## Protocol

This run compares commit `fa9ac8da5ca593b2cc541eb0007f6d0d190aab06` with the current fresh-evidence callback implementation. It uses `stability-v2`, twelve seeds per motion family and seed offset `190000000`. Validation and test each contain 480 traces: 96 motion seeds, each replayed under five measurement profiles. The test set has 300 selection trials and 180 no-selection trials. Profiles sharing one motion seed are correlated observations.

The final set was chosen after development and replay-parity review. Existing horizon/stability settings were selected on validation only; no settings were changed after inspecting this test set. The manifest fingerprints source and compiled predictor, subscription and engine files, plus the corpus and evaluator. Earlier iterations are exploratory and do not establish the final result.

The replay uses stationary visible targets and `includeCurrent: false`. It evaluates the first callback before true target entry, with no-action trials ending at the trace cutoff. It does not measure human intent, browser rendering cost, network traffic, or application cache usefulness.

## Fixed settings

Both implementations use a 120 ms horizon and `stableForMs: 30`.

| Metric                                  |       Frozen |      Current |
| --------------------------------------- | -----------: | -----------: |
| Wrong first actions / 480 trials        |  52 (10.83%) |   41 (8.54%) |
| Useful first actions / 300 selections   | 257 (85.67%) | 254 (84.67%) |
| Median useful lead time                 |     81.95 ms |     77.72 ms |
| Abstentions / 480 trials                |          171 |          185 |
| All callback starts                     |          348 |          316 |
| Wrong starts, including later callbacks |           53 |           41 |
| Aborts before trial cutoff              |           83 |           53 |
| Repeated starts on the same target      |           22 |            4 |

All twelve wrong first actions in the stop-short family disappeared. A turn trial changed from a correct first action to a wrong one, leaving 21 wrong turn actions instead of 20. Pass-by trials retained twenty wrong actions: geometric intersection alone does not identify a deliberate selection.

Useful coverage for slow quantized movement fell from 52/60 to 50/60. Turns lost one useful action, while straight, minimum-jerk and hesitation coverage stayed unchanged. Sparse delivery retained 54/60 useful actions; batched delivery lost one and the outlier profile lost two. Requiring another observation can delay or suppress an otherwise useful start. The improvement is a callback-safety tradeoff, not a universal accuracy gain.

## Settings selected under validation budgets

The existing horizon/stability grid was selected independently for each implementation. A budget constrains validation errors; it does not guarantee the same error rate on unseen data.

| Validation budget per 100 | Implementation | Horizon / stability | Validation wrong / 100 | Test wrong / 100 | Test useful coverage | Median lead |
| ------------------------- | -------------- | ------------------: | ---------------------: | ---------------: | -------------------: | ----------: |
| 5                         | Frozen         |          60 / 50 ms |                   2.92 |             2.92 |               34.33% |    10.28 ms |
| 5                         | Current        |         120 / 50 ms |                   5.00 |             5.42 |               80.33% |    50.47 ms |
| 10                        | Frozen         |          60 / 30 ms |                   7.29 |             7.92 |               80.33% |    23.48 ms |
| 10                        | Current        |         120 / 16 ms |                  10.00 |            11.46 |               86.00% |    95.37 ms |

Under these selected settings, current slow-movement coverage was 39/60 at budget 5 and 57/60 at budget 10, versus 19/60 and 38/60 for the frozen selections. Both current settings exceeded their test error budgets. These rows compare validation-selected policies, not equal realized test error rates, and do not justify changing library defaults.

At budget zero, neither implementation found a qualifying candidate. At budget two, the current 60/50 ms policy achieved 31% test coverage with 2.5 wrong actions per 100, again exceeding its validation budget; the frozen policy abstained entirely.

## Forecasts and cost

At this checkpoint, the production Kalman files matched the baseline source. Both implementations produced identical forecast metrics, including the first 32 ms after a motion change.

| Horizon | Mean endpoint error | Mean error immediately after change |
| ------- | ------------------: | ----------------------------------: |
| 16 ms   |             6.96 px |                            15.44 px |
| 60 ms   |            15.86 px |                            38.94 px |
| 120 ms  |            33.14 px |                            62.55 px |
| 160 ms  |            47.43 px |                            78.01 px |

Each horizon had forecasts on all 19,048 eligible frames. Availability does not imply an eligible callback. The clean sparse/quantized regression also verifies that every fresh observation pair remains forecastable.

On an otherwise idle macOS arm64 machine running Node v24.20.0, median update cost was 0.05306 µs frozen and 0.05334 µs current; prediction cost was 0.09180 µs and 0.09200 µs. These are batch means across nine measured rounds after three warmups. The differences are too small to claim a speed change. This microbenchmark measures the predictor only, not the callback engine or browser event latency.

## Scope and reproduction

The archived robust/adaptive numerical experiments remain benchmark-local. They are excluded from this final comparison and from the published library. Their synthetic covariance experiments do not establish probability calibration for users.

Raw replay successfully imported the existing marked automated backup: 120 eligible trials from one fixture participant. Both implementations produced 45 correct and 46 wrong first actions; current callbacks had fewer aborts and repeats. This verifies the replay path only. No human recordings were available, so no human effectiveness claim is supported.

The historical machine-readable files remain in the ignored `docs/artifacts/stability/final/` directory: `results.json`, `tuning.json`, `summary.json`, `performance.json`, and `automated-replay-smoke.json`. The original invocation is shown below for provenance. Running it against the later filter also includes that filter change; reproducing these historical numbers requires the recorded source snapshot.

```sh
node packages/hasta/benchmarks/stability/run.mjs --repeats 12 --seed-offset 190000000 --output /tmp/hasta-stability-final/results.json
node packages/hasta/benchmarks/stability/perf.mjs --output /tmp/hasta-stability-final/performance.json
node --test packages/hasta/tests/stability-benchmark.test.js packages/hasta/tests/stability-filter.test.js
```

The focused tests cover snapshot integrity, split isolation, causal delivery, silent stops, expired history, rejected forecast evidence, slow-input availability, policy selection, internal numerical invariants and raw-trial grouping. All 25 passed at this checkpoint.
