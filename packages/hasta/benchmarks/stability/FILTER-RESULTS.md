This is the historical first filter study, completed at checkpoint `0a503bbc60adfdece2ca42f06a67b0254966c93b`. Its references to the current filter describe that checkpoint. The subsequent sparse-input change and its independent final results are in [SPARSE-FILTER-RESULTS.md](./SPARSE-FILTER-RESULTS.md).

# Numerical filter results

The accepted change reduces the influence of isolated large measurement residuals during dense input. It preserves the existing API, constant-velocity state model and noise constants (`q: 0.0016`, `r: 0.25`). On the final untouched synthetic set, mean trace-level endpoint error at 120 ms fell by **5.82%**. First-action correctness and useful coverage were unchanged. Updating the filter costs **33.4% more** in the microbenchmark, and some callbacks arrive later.

## Mechanism and scope

The residual magnitude is normalized by the square root of predicted innovation variance. A value above 6 increases effective measurement variance, with bounded inflation. Two aligned large residuals spanning at least 2 ms restore ordinary weighting to allow a change in motion. A gap above 8 ms clears this detector and uses ordinary measurement weighting. The 8 ms condition limits where suppression applies; it is not a response-time guarantee. State and detector history roll back together for same-time corrections and arithmetic failures.

This is one production behavior. There are no new public modes, tuning options, exports, learned models or covariance-confidence claims. Sparse input remains on ordinary Kalman weighting; high-rate input receives the outlier protection.

## Evaluation and acceptance

The control is the original predictor frozen at `fa9ac8da5ca593b2cc541eb0007f6d0d190aab06`, which was identical to the production predictor before this work. Both sides use the **current fresh-evidence callback policy**. The earlier callback-policy improvement therefore cannot account for these filter results.

Development used calibration and validation motion seeds at offset `240000000`. Final evaluation used previously unused test seeds at offset `720000000`: 480 traces, comprising 96 motion seeds under five measurement profiles, with 300 selection trials. Parameters, source hashes, acceptance criteria and validation-selected callback settings were frozen before this run. The runner checks source identity and disjoint seeds before replay. Confidence intervals resample whole motion seeds within each family, keeping correlated profiles together.

The criteria were declared before candidate validation: at least 5% lower 120 ms mean trace error with a paired interval excluding zero; no pooled 120/160 ms p95 regression; at most 2% mean regression at 16/60 ms; bounded family/profile and post-change harm; unchanged forecast availability; and limits on wrong actions, lost useful coverage and common-correct lead time. Existing narrow-channel and reversal episode contracts remained hard checks. **The final implementation passed every criterion and the full browser suites.**

## Untouched test results

Mean error below is the mean of each trace's mean endpoint error. P95 pools forecast frames. These are separate from callback metrics.

| Horizon | Control mean | Current mean | Control p95 | Current p95 |
| ------- | -----------: | -----------: | ----------: | ----------: |
| 16 ms   |     7.812 px |     7.298 px |   42.182 px |   40.140 px |
| 60 ms   |    17.994 px |    16.736 px |   74.456 px |   70.483 px |
| 120 ms  |    38.047 px |    35.833 px |  128.168 px |  121.633 px |
| 160 ms  |    54.576 px |    51.761 px |  169.503 px |  162.556 px |

The paired 120 ms difference was −2.213 px, with a 95% bootstrap interval of [−2.770, −1.758] px. Mean error during the first 32 ms after a motion change fell from 63.603 to 62.549 px at that horizon. Both predictors provided forecasts on all 19,498 eligible frames.

The outlier profile supplied most of the gain: its 120 ms mean fell from 50.799 to 39.675 px, a **21.90% reduction**. The sparse profile was exactly unchanged. Clean, batched and correlated profiles changed by less than 0.09% at 120 ms, with small increases rather than improvements.

Both sides used a 120 ms horizon and `stableForMs: 30` for the primary action comparison.

| Action metric                           |      Control |      Current |
| --------------------------------------- | -----------: | -----------: |
| Correct first actions / 300 selections  | 241 (80.33%) | 241 (80.33%) |
| Wrong first actions / 480 trials        |  57 (11.88%) |  57 (11.88%) |
| Median useful lead                      |     77.60 ms |     78.78 ms |
| All starts                              |          327 |          326 |
| Wrong starts, including later callbacks |           58 |           57 |
| Aborts before cutoff                    |           77 |           67 |
| Repeated starts                         |            6 |            5 |

The median paired lead change among common correct actions was zero. These results support better geometric forecasts and fewer cancellations, not an increase in first-action accuracy.

## Broader checks and timing tradeoffs

The historical comparison corpus supplied 156 additional regression traces. Its 120 ms mean error fell from 18.296 to 17.366 px; availability remained 100%. That corpus has prior model-development history and is not an untouched holdout.

A separate development stress set contains 4,224 traces across 1–33 ms observation intervals, including 7/8/9 ms, jitter, clean/noisy input, per-event spikes and faults scheduled independently of event rate. Its 120 ms mean fell from 45.086 to 42.376 px. With fixed-time faults alone, it fell from 60.354 to 55.324 px. All 168,124 eligible frames remained forecastable. Useful first actions increased from 2,120 to 2,131, while wrong first actions increased from 273 to 277.

All 55 baseline-supported callback phases in the resampled precision paths were retained, with no new adjacent-lane callback. There is still a real timing cost: in the clean 1 ms narrow-channel path, reacquisition occurred at 1112 ms instead of 1088 ms. The first sampled rightward motion was at 1071 ms, so response was **41 ms versus 17 ms**. Passing the original fixture's fixed deadline does not make this a 32 ms response guarantee.

Delay is not confined to subpixel targets. Among 2,113 common-correct first actions in the stress set, fifteen ordinary-target callbacks were later: fourteen by about one 16.67 ms frame and one by 50 ms. All occurred in spike profiles. The 50 ms case retained 42.57 ms of useful lead. These tails remain an explicit tradeoff of suppressing isolated observations.

## Callback settings selected on validation

The filter does not uniformly improve the policy frontier. At a validation budget of two wrong actions per hundred, the control qualified at 1.875 but the candidate's lowest-error setting reached 2.083, so the candidate selector abstained. At budget five, both selected 60/50 ms; test coverage was 30.67% versus 32.33%, with 2.71 versus 2.92 wrong actions per hundred.

At budget ten, validation selected control 120/30 ms and current 60/16 ms. On test, coverage was 80.33% versus 79.00%, error was 11.88 versus 13.33 per hundred, and median lead was 77.60 versus 37.22 ms. Both exceeded the validation budget. No library default was changed from these selected-policy results.

## Cost

On an idle macOS arm64 machine with Node v24.20.0, after three warmup rounds and nine measured rounds:

| Operation | Control median | Current median |                 Change |
| --------- | -------------: | -------------: | ---------------------: |
| Update    |     0.05568 µs |     0.07430 µs | +33.4%, or +0.01862 µs |
| Predict   |     0.09581 µs |     0.09662 µs |                 +0.84% |

These are per-call batch means, including immutable result creation. They do not measure individual-event tail latency or the full browser runtime.

## Iteration record and artifacts

The first bounded-residual candidate passed numerical checks, including an exploratory offset-480M test, but lost existing narrow-channel and reapproach callbacks. It was rejected, and that test set was treated as seen afterward. Increasing fixed process noise fourfold then failed useful-coverage and external short-horizon checks. A temporary process-noise boost passed aggregate checks but lost three baseline-supported reacquisitions in the cadence stress set. The accepted version keeps the original noise constants and clears residual history when a gap is too long for provisional suppression. The version that retained history across that gap was superseded.

Final artifacts are in ignored `docs/artifacts/stability/filter-final/`: `results.json`, `summary.json`, `external.json`, `cadence.json`, and `performance.json`. The frozen development selection is in `filter-production-development-final/results.json`. Rejected results remain under `filter-development/` and `filter-pre-browser-review/`; probe source archives include original hashes and runnable copies with relocated imports.

The [README](README.md) contains runnable commands. The final source/dist fingerprints were verified against disk after evaluation. No human recordings were available; all effectiveness and timing results here are synthetic engineering evidence.
