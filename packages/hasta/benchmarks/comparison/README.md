# Hasta prediction model comparison

This harness compares forecast accuracy, target-hit stability, and model cost. `cv` uses a frozen build from commit `23e16ac`, so changes to the default predictor do not change the baseline. The production `KalmanPredictor` uses a Kalman filter with a constant-velocity motion model. The production filter has a separate experiment in [kalman-experiment.mjs](./kalman-experiment.mjs).

Tune the production Kalman filter and evaluate it on new seeds:

```sh
npm --workspace @66hex/hasta run bench:kalman -- --phase tune --output /tmp/hasta-kalman/results.json
npm --workspace @66hex/hasta run bench:kalman -- --phase evaluate --output /tmp/hasta-kalman/results.json
npm --workspace @66hex/hasta run bench:comparison:perf -- --results /tmp/hasta-kalman/results.json
```

Before `evaluate`, write the selected configuration from `tuning.json` into the library's internal defaults. The script checks that the parameters and protocol match. The current defaults match the saved tuning result. The final evaluation uses new seeds; `protocol.json` freezes all profiles and the objective function. Filter parameters are not part of the public API.

## Running the harness

Run commands from the repository root. Use Node.js 24 or later and the dependencies in the lockfile:

```sh
npm ci
npm --workspace @66hex/hasta run browsers:install
```

Browser installation is required for performance measurements. Accuracy evaluation runs in Node alone.

Run the full tuning and accuracy evaluation:

```sh
npm --workspace @66hex/hasta run bench:comparison
```

The script builds the library, tunes the models, and evaluates the frozen configurations. It writes artifacts to `/tmp/hasta-comparison` by default. `--quick` reduces the parameter grid, trace count, and particle-filter repetitions; use it to check that the harness works:

```sh
npm --workspace @66hex/hasta run bench:comparison -- --quick --output /tmp/hasta-comparison-smoke/results.json
```

Tuning and evaluation can run separately:

```sh
npm --workspace @66hex/hasta run bench:comparison -- --phase tune --output /tmp/hasta-comparison/results.json
npm --workspace @66hex/hasta run bench:comparison -- --phase evaluate --output /tmp/hasta-comparison/results.json
```

The `evaluate` phase reads `tuning.json` from the directory selected by `--output`. Both phases must use the same mode: full or `--quick`. Both commands rebuild the library. Keep the code unchanged between phases and use a separate output directory for each experiment, because auxiliary filenames are fixed.

After accuracy evaluation, measure performance:

```sh
npm --workspace @66hex/hasta run bench:comparison:perf -- --results /tmp/hasta-comparison/results.json
```

This script uses the configurations in the supplied JSON and the existing `dist`; it does not build the library. It measures Node, Chromium, Firefox, and WebKit in sequence, then measures memory in separate Node processes. `--quick` reduces the number of timing rounds but retains every model in the results file. Stop other benchmarks, tests, and builds while measuring.

`--memory-only` repeats only the memory measurement and preserves timings from the existing `performance.json`. It requires identical model configurations. `timingGeneratedAt` retains the timing measurement date.

Artifacts:

| File                                      | Contents                                                                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `tuning.json`                             | Every tested configuration, its training score, selected parameters, and training trace identifiers.                                      |
| `results.json` or the `--output` filename | Aggregate metrics, individual trace and repetition results, configurations, evaluation trace identifiers, and the Node environment.       |
| `rows.partial.json`                       | Evaluation progress saved after each model. This is a working file; the harness does not resume from it.                                  |
| `performance.json`                        | Timings for each engine, browser versions, configurations, and memory measurements. Written beside the file supplied through `--results`. |

Data generators and particle filters use fixed seeds. To reproduce a result, also preserve the repository revision, lockfile, and artifacts. Execution time depends on the machine and its load; result files record basic environment information.

After both measurements, create a compact archive:

```sh
npm --workspace @66hex/hasta run bench:comparison:archive -- --results /tmp/hasta-comparison/results.json --destination /tmp/hasta-comparison/archive
```

The archive contains compressed raw results in `accuracy.json.gz`, aggregates and additional difference intervals against regression and Kalman in `summary.json`, `performance.json`, and a `provenance.json` manifest. The manifest records SHA-256 hashes of sources, build output, and data, together with the baseline commit and working tree status at archive time. Archive before making further code changes.

## Models and tuning in the original comparison

The following models, grid, and datasets describe `bench:comparison`. The `bench:kalman` experiment has a separate protocol, initialization, and objective that accounts for maneuver response. Its implementation is in [kalman-experiment.mjs](./kalman-experiment.mjs).

Every model returns a segment from its estimated position at `now` to its position after the requested horizon. The result is an immutable snapshot, including during performance measurements.

| Model                  | Estimate                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cv`                   | Frozen `ConstantVelocityPredictor` from `23e16ac`: velocity from the last two samples with distinct timestamps, with position anchored to the latest measurement. |
| `regression`           | Velocity from linear regression over a time window, with position anchored to the latest measurement.                                                             |
| `kalman`               | Position and velocity state, continuous white acceleration noise, and Gaussian position measurements. Also smooths position.                                      |
| `particle-gaussian-*`  | Bootstrap/SIR filter with the same motion model and Gaussian measurements. Returns the weighted particle mean.                                                    |
| `particle-student-t-*` | The same particle filter with a Student's t distribution with four degrees of freedom for measurement error. Its variance matches `r`.                            |

Kalman and the particle filter share a transition model: per axis, `Q = q * [[dt³/3, dt²/2], [dt²/2, dt]]`, with time in milliseconds. `q` is in px²/ms³, and `r` is the measurement variance in px². Initial velocity has mean zero and standard deviation 2 px/ms. The particle filter uses logarithmic weights and systematic resampling when effective sample size falls below half the particle count.

Full training tests regression windows of 4, 8, 16, and 32 ms and pairs of `q ∈ {1e-6, 1e-4, 1e-2, 0.1}` and `r ∈ {0.01, 0.25, 4}`. The particle filter is tuned with 256 particles and two algorithm seeds. Each model family receives one global configuration, selected by mean forecast endpoint error across traces, horizons, and repetitions. An invalid forecast disqualifies a configuration.

Selected parameters are frozen before evaluation. The particle filter is then evaluated with 64, 256, and 1024 particles, using five algorithm seeds different from the tuning seeds. Parameters are not adjusted for a particular trajectory, noise profile, or particle count. `--quick` reduces the experiment and cannot support a final recommendation.

## Data and delivery timing

Traces are synthetic, last 1500 ms, and have evaluation frames at 60 Hz with a reproducible random phase. Forecast horizons are 16, 60, and 120 ms. Motion, measurement noise, frame phase, and particle-filter draws use separate random streams. A motion family and seed retain identical trajectories and target geometry across measurement profiles.

| Dataset    | Motion and measurements                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `train`    | Straight motion, acceleration, stopping, turning, and arcs; clean, noisy, lower-rate, and irregular measurements. Two motion seeds per combination. |
| `known`    | The same families and profiles, with three new seeds per combination.                                                                               |
| `motion`   | Reversal, minimum-jerk motion, figure eights, and overshoot correction; a known noise profile.                                                      |
| `sensor`   | Known straight, turn, and arc families; new profiles with quantization, outliers, correlated noise, and delivery gaps.                              |
| `combined` | New motion families with new measurement profiles.                                                                                                  |

In the full evaluation, `motion`, `sensor`, and `combined` also have three seeds per combination. Training and all evaluation datasets have disjoint motion seeds. Profiles also include batched delivery, delays, and repeated timestamps.

A model receives a sample only when `arrivedAt <= now`; it uses the sample's `timeStamp` to calculate motion. Samples are rejected if their timestamps move backward, fall after delivery, or are already at least 100 ms old on delivery. Forecasting requires two samples with distinct timestamps. A latest sample age or inter-sample gap of at least 100 ms resets the history. A sample with the same timestamp replaces its predecessor; filters do not count it again as an independent measurement.

Each trace has six rectangular targets: three on the trajectory and three offset from it. The hit oracle samples the true path every 0.5 ms and intersects successive short segments with the rectangles, accounting for turns within the horizon. Tests also check sensitivity to a 0.25 ms step. Targets already in contact with the pointer at evaluation time are excluded from predicted-hit and ETA metrics.

## Reading accuracy and stability results

`results` includes `all`, `known`, `motion`, `sensor`, and `combined` groups, plus `byFamily` and `byProfile` breakdowns. Start with breakdowns and horizons: the overall average can hide worse performance after a sudden turn or on a clean signal.

| Field                                           | Meaning                                                                                                                                                                                         |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meanErrorPx`                                   | Mean Euclidean forecast endpoint error in pixels, with equal weight for traces and horizons. Particle-filter repetitions are averaged within each trace first. Lower is better.                 |
| `perHorizon[].rmsePx`                           | Root mean squared error; penalizes large errors more heavily.                                                                                                                                   |
| `meanTraceP95Px`                                | Mean of the p95 values for individual traces and repetitions, not a pooled p95 across all frames.                                                                                               |
| `postChangeMeanErrorPx`                         | Error in the first 32 ms after a motion change in families with an annotated change time.                                                                                                       |
| `precision`, `recall`, `confusion`              | Target hits within a horizon; precision is TP/(TP+FP), recall is TP/(TP+FN). Counts refer to frame–target pairs; aggregate groups sum horizons.                                                 |
| `etaMeanErrorMs`                                | Absolute ETA error in milliseconds, only for true positive hits at the 120 ms horizon. Read with recall and `etaTruePositiveCount`.                                                             |
| `etaMeanTraceP95ErrorMs`                        | Mean of p95 ETA errors across traces with hits.                                                                                                                                                 |
| `arrivalMeanJitterMs`                           | Change in predicted absolute arrival time between successive frames when the true arrival time changes by less than 2 ms. Lower means more stable ETA; `arrivalPairCount` gives the pair count. |
| `predictionFlipsPerTrace`, `truthFlipsPerTrace` | Mean hit/no-hit transitions per trace, summed across targets and horizons. Compare both fields because motion also changes the true classification.                                             |
| `availability`                                  | Fraction of frames with valid forecasts for every horizon among frames with sufficiently fresh input.                                                                                           |
| `dataEligibility`                               | Fraction of all frames with sufficiently fresh input and two distinct measurement times. Shows gaps caused by startup or dropout; `availability = 1` does not mean full coverage.               |
| `invalidForecasts`                              | Missing forecasts or forecasts with NaN or infinite coordinates for individual horizons despite eligible input.                                                                                 |
| `particleSeedSpreadPx`                          | Range of mean errors across particle-filter seeds, calculated per trace and then summarized. Shows sensitivity to algorithm randomness.                                                         |
| `meanErrorDifference95CI`                       | Interval for the mean error difference against CV in pixels. Negative values mean the evaluated model has lower error.                                                                          |

The difference interval uses 2000 paired bootstrap repetitions. Entire motion-seed blocks are sampled within dataset/family strata; profiles of the same motion stay together. Frames and particle-filter repetitions are not treated as independent trajectories. With one seed, as in `--quick`, it reports insufficient blocks. Even the full experiment has few independent seeds, so the interval describes uncertainty in this corpus, not across all users.

`null` means no observations or an undefined ratio. Details and counts are in `rows`. Low ETA error with low recall can result from missing difficult hits.

## Reading performance results

[performance.mjs](./performance.mjs) measures `update` and `predict` separately. Workloads represent 125, 1000, and 8000 Hz, plus 8000 Hz with timestamps quantized to 1 ms. Three warmup rounds precede 15 measured rounds, or five with `--quick`. Model order rotates between rounds.

Call counts grow adaptively until a batch lasts at least 20 ms or reaches its limit. For `update`, each fresh instance receives an ordered history of 1000 samples; the timer covers updates to all copies, which are created before timing begins. The limit is 2048 copies. For `predict`, the call count grows to at most 8,192,000. The 20 ms target is not guaranteed once the limit is reached. `minUpdateBatchMs` and `minPredictBatchMs` report the shortest actual batches; `finalUpdateCallsPerBatch` and `finalPredictCallsPerBatch` report the final call counts.

`medianUs`, `minUs`, and `p95BatchMeanUs` are microseconds per call. Each observation is the mean of a whole batch. `p95BatchMeanUs` does not measure individual-event tail latency or the worst garbage-collection pause. `predict` runs repeatedly on the same state after updates finish; it includes result creation and freezing.

Memory measurement compares retained memory before and after creating 128 active instances, with forced garbage collection. It separately tests samples every 1 ms and 0.125 ms: 32 and 256 samples respectively, covering histories of 31 and 31.875 ms. Each configuration and profile has three repetitions in separate processes. Results report bytes per instance separately for heap and `ArrayBuffer`. They are sensitive to allocator and garbage-collector noise and do not measure total RSS or runtime allocation rate.

All 32 warmup instances remain reachable across both readings so later collection cannot reduce the difference. Buffer size is also calculated from one instance's object graph without counting aliases twice. Measurement stops if the `ArrayBuffer` reading disagrees with this check. In the current particle filter, buffers alone occupy exactly `128 * particleCount` bytes per instance.

## Limits of the results

This corpus has known ground truth but no recordings of real users, devices, or browsers. Targets are stationary, and there is no model of intentional target selection. Results support further experiments with the library; changes to the default model should also be evaluated on real traces.

The particle filter is an SIR filter with constant-velocity motion and acceleration noise. The comparison does not model multiple possible user intentions, multiple targets as hypotheses, or predicted hit probabilities. Reducing particles to their mean produces the same segment format as the other models and does not use the full distribution for hit decisions.

The harness gives models the complete accepted sample stream. The Hasta runtime now does the same, matching the experiment. In baseline commit `23e16ac`, the runtime retained at most the last two samples with distinct timestamps before a frame; that was enough for the old CV model but would discard data needed by the filter.

Performance measurements cover the models alone. DOM handling, bounds measurement, spatial indexing, target selection, frame scheduling, and application callbacks are outside their scope. Microsecond results are not total interaction latency. Compare models within the same run for each engine and repeat measurements on an otherwise idle machine.
