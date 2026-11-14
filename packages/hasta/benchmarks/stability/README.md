# Prediction and callback stability

The current predictor adds adaptive velocity smoothing and bounded intersection release hysteresis. Run `node packages/hasta/benchmarks/stability/cursor-jitter.mjs` after building to compare endpoint jitter, repeated starts, acquisition lead, and maneuver response with the frozen `5cf01cf` predictor. The replay reports filter-only and filter-plus-hysteresis results separately across five cadences and noisy, quantized, and irregular input. These are synthetic diagnostics; the browser tests exercise the actual engine, including coalesced input and lifecycle cancellation.

This directory preserves versioned numerical and callback controls. The [adaptive predictor CPU comparison](#adaptive-predictor-cpu) uses the stabilized predictor at `d514639`. The earlier [CPU study](ITERATION3-RESULTS.md) measures faster updates with exact forecast and callback parity against `5cf01cf`. The preceding [numerical study](SPARSE-FILTER-RESULTS.md) compares that predictor with `0a503bbc60adfdece2ca42f06a67b0254966c93b`, following the [balanced cadence protocol](SPARSE-FILTER-PROTOCOL.md). These changes keep the existing public API.

Historical general runners still default to the original predictor and subscription at `fa9ac8da5ca593b2cc541eb0007f6d0d190aab06`. The snapshots in `baseline-fa9ac8d/`, `baseline-0a503bb/`, and `baseline-5cf01cf/` have source and compiled-file integrity manifests. The runtime requires new pointer evidence before starting a speculative callback.

The [first filter results](FILTER-RESULTS.md) record the dense-input numerical improvement while using the same callback policy on both sides. The earlier [callback-only results](RESULTS.md) record observation freshness before either filter update.

## Isolate a filter change

`filter-run.mjs` compares the frozen original predictor with the built production predictor. Both use the same current `Subscription`, so callback-policy changes cannot masquerade as filter improvements. Development evaluates validation seeds only. Final evaluation requires the development artifact and rejects changed source hashes, acceptance criteria, candidate identity, or overlapping motion seeds before replay.

```sh
node packages/hasta/benchmarks/stability/filter-run.mjs --label production --output /tmp/hasta-filter-development/results.json
node packages/hasta/benchmarks/stability/filter-run.mjs --stage final --label production --seed-offset 720000000 --selection /tmp/hasta-filter-development/results.json --output /tmp/hasta-filter-final/results.json
node packages/hasta/benchmarks/stability/filter-external.mjs --output /tmp/hasta-filter-final/external.json
node packages/hasta/benchmarks/stability/filter-cadence.mjs --output /tmp/hasta-filter-final/cadence.json
```

Acceptance criteria are recorded in `filter-evaluation.mjs` and each artifact. They constrain mean/tail error, post-change response, subgroup harm, availability, useful-action coverage, wrong actions and common-correct lead time. Paired confidence intervals resample motion seeds within each family; correlated measurement profiles remain in the same block. Existing narrow-channel and reversal episode contracts are additional hard checks.

The external runner uses the historical comparison corpus as a regression set, not a new untouched holdout. The cadence runner varies event intervals from 1 to 33 ms, including 7/8/9 ms and jitter. It tests per-event and cadence-independent timed faults separately, preserves baseline-supported later callback episodes, and reports actual turn-response delays. Its 32 ms timing diagnostic is not a universal latency guarantee.

`--candidate /path/to/module.mjs` permits benchmark-local research modules exporting `KalmanPredictor`. This is a benchmark facility, not a library mode or option. Final source, defaults and criteria must be frozen before using a new holdout seed offset.

## Run an experiment

Build once and use a fresh output directory:

```sh
npm run build --workspace=@66hex/hasta
node packages/hasta/benchmarks/stability/run.mjs --output /tmp/hasta-stability/results.json
```

`--quick` uses one seed per motion family for a smoke run. The default uses four. A larger run can use twelve and a fresh seed offset:

```sh
node packages/hasta/benchmarks/stability/run.mjs --repeats 12 --seed-offset 190000000 --output /tmp/hasta-stability-large/results.json
```

Use a new offset when earlier results have informed development. `--phase tune` writes `tuning.json`; `--phase evaluate` reads it and rejects changes to source, compiled implementation, corpus, or protocol. The default `--phase all` performs both steps. Files are created exclusively so a rerun cannot overwrite an earlier result.

## Data and causal replay

The corpus includes straight and minimum-jerk movement, turns, reversals, stopping short, hesitation, passing without selection, and slow movement quantized to CSS pixels. Each motion has clean, sparse, batched/delayed, outlier, and correlated-noise delivery. A stopped pointer stops generating observations.

Validation and test use disjoint motion seeds. All measurement profiles for one seed stay in the same split. The optional numerical experiments also have a separate calibration split. Samples affect a prediction only after their delivery time. Older, future-dated, and stale-on-delivery samples are excluded. Explicit resets and frame-driven expiry clear history.

Targets are stationary and visible. Registration order uses a separate random stream, so simultaneous callbacks do not systematically favor the chosen goal. The first-entry oracle intersects true-path segments sampled every 0.5 ms. Synthetic selection labels distinguish reaching the requested goal from passing through another target or ending without a selection. This lets an accurate geometric forecast produce a wrong action; it does not establish how real users choose targets.

Replay uses the actual frozen/current `Subscription` classes and the predictor's intersections. It follows engine candidate bounds, latched contact/crossing handling, input freshness, and cancellation for `includeCurrent: false`. It does not simulate DOM occlusion, moving targets, or application callbacks that mutate the document.

## Metrics

The fixed comparison uses a 120 ms horizon and `stableForMs: 30` for both implementations. The main action score uses the first callback before the selected target's first entry, or before the end of a no-selection trial. A correct first callback contributes to useful-action coverage and lead time. A callback for another target is wrong. No callback is an abstention. All starts, wrong starts, cancellations, and repeated starts are also reported. These are simulated callback episodes, not downloaded bytes or cache hits.

A second comparison selects existing horizon and stability settings using validation data: horizons of 60, 120, and 160 ms and stability durations of 0, 16, 30, and 50 ms. It maximizes useful-action coverage, then median lead time, subject to a validation budget of 0, 2, 5, or 10 wrong first actions per 100 trials. Test errors may exceed that budget. If no candidate qualifies, the policy abstains from every action. Zero errors with almost no useful coverage is not evidence of a useful configuration.

Forecast results cover 16, 60, 120, and 160 ms. They include pooled endpoint errors, the mean of trace-level mean errors, error during the first 32 ms after an annotated motion change, and availability. Per-family and per-profile breakdowns expose losses hidden in the aggregate. The general `run.mjs` comparison includes both filter and callback changes; use `filter-run.mjs` to isolate numerical changes.

## Internal numerical experiments

`--experiments` additionally evaluates archived robust/adaptive filter implementations under names prefixed with `experimental-`. These JavaScript snapshots live only under `benchmarks/stability/experimental/`, have integrity manifests, and are not exported, imported by production code, or included in the published package. They preserve exploratory work without adding library modes or options.

Only those experimental variants expose covariance to this harness. Their optional variance multiplier is fitted on the calibration split, with equal weight per trace, before validation and test. Reports include nominal 50%, 90%, and 95% two-dimensional Gaussian coverage and horizon-specific scale diagnostics. Experimental action gates can use absolute or target-relative uncertainty. Those gates are benchmark code, not library API. Synthetic coverage does not calibrate a human probability, and the numerical variants must not be presented as deployed improvements.

## Raw lab replay

```sh
node packages/hasta/benchmarks/stability/lab-run.mjs --output /tmp/hasta-human-motion.json /path/to/session-backup.json.gz
```

Supply eligible backups from at least three participants for human evaluation. The loader uses the collector's checksum/schema validation, keeps the longest consistent cumulative checkpoint, and rejects conflicting copies, mixed builds, and duplicate participant/session recordings. Only eligible, resolved main trials are replayed. Selected trials without a recorded first entry are excluded and counted. Both sessions of one person stay together.

For each held-out participant, horizon/stability selection uses only the other participants. Motion parameters remain unchanged. Individual folds and pooled held-out action counts are reported. Pointer recordings do not provide continuous latent ground truth, so the script does not infer covariance coverage from them.

`--allow-automated` accepts the collector's marked automated fixture for a pipeline smoke check. That run reports fixed-policy results and omits human held-out evaluation. It is not evidence of user accuracy.

Other experiments can import `loadLabTraces(paths, { allowAutomated })` and `tracesFromSessions(sessions)` from `lab.mjs`. The adapter preserves participant/session/device grouping and the original trial.

## Cost

After tests finish, run on an otherwise idle machine:

```sh
node packages/hasta/benchmarks/stability/perf.mjs --output /tmp/hasta-stability-performance.json
```

This measures frozen/current `update` and `predict`, with three warmup rounds and nine measured rounds in rotating order. `--experiments` also measures the internal numerical snapshots and their uncertainty accessor. Times are microseconds per call from batch means, including immutable output creation. They do not measure individual-event tail latency or the full browser runtime.

## Adaptive predictor CPU

`adaptive-cpu.mjs` compares production with the frozen `d5146391a816121c2296ec9a3dcc85caaf70032b` predictor. The optimization shares residual length and direction between the two filter callbacks and reuses two adaptation buffers. Buffers are allocated when input starts; a checkpoint stays intact for same-timestamp corrections and arithmetic recovery. Projection validation uses scalar finite checks instead of allocating an array. Intersection queries with the same time and horizon reuse one private projection, invalidated by new input and resets. The predictor passes its copied, validated samples directly to the internal filter; the filter's standalone `update` retains validation. Filter coefficients, maneuver thresholds, prediction horizons, and release hysteresis are unchanged.

Build and finish other tests before collecting CPU measurements on an idle machine. Each output must be a new file:

```sh
npm run build --workspace=@66hex/hasta
node packages/hasta/benchmarks/stability/adaptive-parity.mjs --output /tmp/hasta-adaptive-parity.json
node packages/hasta/benchmarks/stability/adaptive-cpu.mjs --output /tmp/hasta-adaptive-cpu-1.json
node packages/hasta/benchmarks/stability/adaptive-cpu.mjs --output /tmp/hasta-adaptive-cpu-2.json
node packages/hasta/benchmarks/stability/adaptive-frame-cpu.mjs --output /tmp/hasta-adaptive-frame-1.json
node packages/hasta/benchmarks/stability/adaptive-frame-cpu.mjs --output /tmp/hasta-adaptive-frame-2.json
```

The timing runner uses three warmup rounds and nine measured rounds, rotates implementation order, and measures 1,048,576 calls per batch. It records all rounds and paired bootstrap 95% intervals for candidate/baseline time ratios. The primary target is at least 10% less CPU per intersection query for eight targets sharing a frame time and horizon, after 125 Hz input. Both clean input and periodic outliers must pass. Every group of eight starts with a projection cache miss; individual-query measurements always change the time to exercise cache misses. Guards cover 1, 4, 16.67, and 33 ms intervals, same-timestamp corrections, prediction, intersection, and construction. A ratio interval wholly above 1 flags a regression. Both fresh-process confirmations must pass the primary target. Inspect `primaryPasses` and every entry in `regressions`; the runner writes failed comparisons too. Performance flags are reviewed for repeatability, absolute cost, and frequency in the frame workload below. Small isolated CPU losses can be accepted when the combined workload improves; exact numerical parity and functional tests remain required.

`adaptive-frame-cpu.mjs` measures two input updates, one immutable forecast, and 1, 4, 8, or 32 target queries per frame. Input arrives every 8 ms and includes periodic outliers. New input invalidates the projection before each frame. Target bounds and model construction are outside timing. This measures the combined prediction work; DOM bounds, spatial indexing, subscriptions, and rendering are excluded. It uses 131,072 frames per batch, three warmup rounds, nine measured rounds, and rotating implementation order.

The parity runner compares exact Float64 query digests, availability, frame decisions, and endpoint errors across 2,424 synthetic traces. This covers 213,450 updates, 2,249 resets, 402,972 predictions, and 2,374,800 rectangle queries. Unit tests separately exercise configurable noise, decimation, measured anchoring, repeated replacements, arithmetic failures, subnormal values, expiry, and resets. Historical replay does not implement release hysteresis; browser tests cover the actual runtime. These measurements establish synthetic CPU cost and behavioral equivalence on the tested inputs, not whole-page latency or a performance guarantee for every engine.

### Results, 2026-11-14

Two fresh-process confirmations on Node 24.20.0, Darwin arm64 passed the eight-target CPU target. Individual updates at 8 ms were 10.9–12.6% faster for clean/outlier input and 13.8–14.9% faster for same-timestamp corrections. Batched intersection queries improved by 14.0–19.6% across all measured cadences and profiles.

The combined core-frame workload also improved in both runs:

| Targets | Run 1, before → after (µs/frame) | Run 1 reduction | Run 2, before → after (µs/frame) | Run 2 reduction |
| ------- | -------------------------------- | --------------- | -------------------------------- | --------------- |
| 1       | 0.4437 → 0.4047                  | 8.8%            | 0.4433 → 0.4053                  | 8.6%            |
| 4       | 0.7066 → 0.6332                  | 10.4%           | 0.7297 → 0.6366                  | 12.8%           |
| 8       | 1.0494 → 0.8810                  | 16.0%           | 1.1281 → 0.9314                  | 17.4%           |
| 32      | 3.2386 → 2.5619                  | 20.9%           | 3.0750 → 2.4974                  | 18.8%           |

The tradeoff is visible in isolated calls that always miss the projection cache. Across both runs, prediction point estimates ranged from a 3.7% slowdown to a 2.4% improvement; isolated intersections ranged from a 2.5% slowdown to a 5.0% improvement. Most intervals included no change. The only flagged slowdowns were prediction at 33 ms/clean in run 1 (0.38%) and 8 ms/clean in run 2 (0.57%), about 0.4 and 0.5 ns per call in these batch means. Construction had no flagged slowdown. The measured frame savings justify retaining this version; this is not a claim that every isolated operation is faster.

Local raw artifacts under `docs/artifacts/adaptive-cpu/` are `accepted-run-1.json`, `accepted-run-2.json`, `frame-confirmation-1.json`, `frame-confirmation-2.json`, and `parity-v4.json`. Their source and compiled hashes match the selected implementation. The parity run had zero mismatches. These files are ignored experiment outputs; the commands above reproduce the measurements with new output paths.

Later attempts to remove the small isolated-call cost were rejected when their intersection timings became less consistent. The retained implementation preserves exact numerical behavior, including turns, braking, and subnormal arithmetic. Runtime release hysteresis is unchanged.

Validation passed `ci:quality`, 194 unit tests, 786 library browser tests across Chromium/Firefox/WebKit, and 102 framework-adapter tests. The broader website suite had one existing WebKit contrast failure in `apps/web/tests/horizontal-scroll.spec.js:193` (mobile code/table accessibility); the same failure was reproduced with the predictor restored to `d514639`. No website styles changed in this iteration.

## Earlier CPU protocols

The second numerical study freezes the previously accepted filter at `0a503bb`. Its
[protocol](./SPARSE-FILTER-PROTOCOL.md) separates balanced cadence measurements from the old
480-trace regression corpus. [Decisions and results](./SPARSE-FILTER-RESULTS.md) include rejected
candidates. These numerical experiments keep the existing public predictor API.

```sh
# Exploratory training may use3 repetitions. Development always uses12.
node packages/hasta/benchmarks/stability/filter-study-run.mjs --stage training --repeats 3 --candidate /absolute/source-only/index.mjs --label hypothesis --output /tmp/hypothesis-training.json
node packages/hasta/benchmarks/stability/filter-study-run.mjs --stage development --candidate /absolute/source-only/index.mjs --label hypothesis --output /tmp/hypothesis-development.json
# Run only after a passing development selection.
node packages/hasta/benchmarks/stability/filter-study-run.mjs --stage cadence --candidate /absolute/source-only/index.mjs --label hypothesis --selection /tmp/hypothesis-development.json --output /tmp/hypothesis-cadence.json
# Keep the external historical regression check on the new control explicit.
node packages/hasta/benchmarks/stability/filter-external.mjs --control 0a503bb --candidate /absolute/source-only/index.mjs --label hypothesis --output /tmp/hypothesis-external.json
```

The new runner evaluates fixed120/30 actions for acceptance and fixed120/0 as a diagnostic.
It compacts replay output after each trace to avoid retaining every intersection object.
All profiles and cadences remain grouped within their shared motion seed for bootstrap
inference. Candidate source directories must contain only the frozen source dependencies;
write result JSON elsewhere because source fingerprints include JavaScript and JSON files.

After source integration, rerun development using built production with no `--candidate`.
Final evaluation uses `--stage final --selection /path/to/production-development.json` and
requires the same passing production selection, source hashes, gates, and control. The
reserved final set must remain unopened until production approval. A new source revision
needs another development freeze; a revision after final results also needs a new holdout.

Existing `filter-run.mjs`, `filter-external.mjs`, `filter-cadence.mjs`, and `perf.mjs` retain
`fa9ac8d` as the default control for historical use. Select `--control 0a503bb` explicitly for
this study. For CPU measurements use `node packages/hasta/benchmarks/stability/perf.mjs
--control 0a503bb --output /tmp/hypothesis-performance.json` only when the machine is idle
and a candidate has passed quality checks.

Iteration 3 separates exact CPU optimization from action-behavior research. Its frozen
current control is `5cf01cf`; the older `0a503bb` remains a retention reference. See the
[protocol](ITERATION3-PROTOCOL.md) and [results](ITERATION3-RESULTS.md). Historical runners
and their default controls remain unchanged.

```sh
node packages/hasta/benchmarks/stability/iteration3-run.mjs --lane cpu --stage development --label optimization --output /tmp/optimization-development.json
node packages/hasta/benchmarks/stability/iteration3-run.mjs --lane cpu --stage cadence --label optimization --selection /tmp/optimization-development.json --output /tmp/optimization-cadence.json
```

Use `--candidate /absolute/source-only/index.mjs` for a frozen research candidate, and omit
it after production integration. `--lane actions` applies the separately preregistered
behavior gates. Exploratory training accepts `--stage training --repeats 3`; development,
cadence validation, and final always use 12 repetitions. Exact query digests preserve
Float64 values and signed zero; callback episodes at both stability durations are checked
separately. CPU acceptance also requires two isolated timing confirmations before the final
set may be opened. The final command uses `--stage final` and the same passing production
selection, source fingerprints, lane, and label.
