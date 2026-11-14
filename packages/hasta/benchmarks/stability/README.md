# Prediction and callback stability

This harness compares the current library with the production predictor and subscription frozen at commit `fa9ac8da5ca593b2cc541eb0007f6d0d190aab06`. The library keeps its existing API. The runtime requires new pointer evidence before starting a speculative callback.

The frozen implementation lives in `baseline-fa9ac8d/`. Its manifest records source and compiled-file hashes; tests verify the captured bytes.

The [filter results](FILTER-RESULTS.md) isolate numerical changes while keeping the current callback policy on both sides. The earlier [callback-only results](RESULTS.md) record the observation-freshness change before the filter update.

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
