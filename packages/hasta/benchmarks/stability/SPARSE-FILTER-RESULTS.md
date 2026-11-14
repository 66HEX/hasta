The production filter passed the reserved final holdout against the accepted Hasta filter
at `0a503bbc60adfdece2ca42f06a67b0254966c93b`. Mean trace error at 120 ms fell by 6.65%, and the
targeted 8–17 ms timed-spike error fell by 17.60%. All 644 predefined checks passed. The
change keeps the existing public API and base `q/r` settings; there are no new modes or ML.

For sample gaps above 8 ms and up to 40 ms, the filter compares the new displacement with
the larger of filtered speed and the preceding recent measured speed. Reversals and steps
consistent with that speed retain ordinary weighting. An unusually fast step can receive
less weight through measurement-noise inflation based on the total innovation variance.
The existing dense-input behavior remains unchanged. Genuine acceleration can still be
suppressed, and consecutive faulty measurements can support each other.

This compares previous Hasta implementations with independently developed numerical candidates.

Acceptance criteria were recorded in [SPARSE-FILTER-PROTOCOL.md](./SPARSE-FILTER-PROTOCOL.md).
The balanced corpus contains eight existing motion families, eight cadences, three noise
profiles, regular/jittered delivery, and twelve seeds per family: 4608 traces in 96 paired
motion blocks. The final offset 1440000000 was opened only after production integration,
source freezing, and all existing checks passed. No parameters changed after that run.
The balanced and legacy corpora share motion-family definitions; cadence validation used
different frequencies and motion seeds. All evidence is synthetic, not human efficacy.

| Final horizon | Mean trace error, control→production |  Pooled endpoint p95 | Post-change mean error |
| ------------- | -----------------------------------: | -------------------: | ---------------------: |
| 16 ms         |                     9.2135→8.4441 px |   48.8471→43.8446 px |     16.5078→15.7566 px |
| 60 ms         |                   21.1350→19.4439 px |   89.6476→80.1616 px |     42.4021→40.7022 px |
| 120 ms        |                   43.5400→40.6429 px | 150.9519→136.8097 px |     70.4423→67.3546 px |
| 160 ms        |                   61.5554→57.8881 px | 197.3170→181.6313 px |     88.4772→84.3911 px |

The paired 95% interval for the 120 ms mean difference is [−3.5162,−2.3778] px, resampling
whole motion blocks within families. The targeted timed-spike mean changes from 62.3117 to
51.3457 px. Forecast availability stays identical at 184962 frames per horizon. Every
family/profile/cadence bound and every exact or control-supported precision episode passes.

| Final fixed 120 ms policy              | Correct first actions | Wrong first actions | Aborts | Restarts |
| -------------------------------------- | --------------------: | ------------------: | -----: | -------: |
| Control, stability 30 ms               |                  2285 |                 412 |    576 |       36 |
| Production, stability 30 ms            |                  2310 |                 416 |    555 |       30 |
| Control, stability 0 ms, diagnostic    |                  2342 |                 995 |   2512 |     1247 |
| Production, stability 0 ms, diagnostic |                  2359 |                 977 |   2333 |     1142 |

These 4608 trials include 2880 selected-target trials. With 30 ms stability, useful coverage
increases by 0.8681 percentage points and wrong first actions increase by 0.0868 points.
The four additional wrong actions occur in turn traces with timed spikes. Clean and ordinary
noisy profiles retain their action counts. Minimum-jerk traces lose two correct first actions,
despite the overall gain of 25. Among 2281 common-correct trials, five starts are later, with
a maximum loss of 33.33 ms; median lead difference is zero. Lower endpoint error therefore
does not imply fewer wrong first actions under every callback policy. Stability 0 ms is an
additional diagnostic and does not change the acceptance criteria.

The old 480-trace corpus passes non-inferiority on the final seeds: 120 ms mean changes from
37.0693 to 37.0270 px, while correct 250/wrong 47 and aborts 51 stay unchanged. The external
156-trace historical corpus also passes. Existing data are regression checks, not additional
unseen evidence.

CPU cost is measured separately from accuracy on an idle machine. The standard dense 1 ms
benchmark gives median update cost 0.07258→0.07143 microseconds and prediction cost
0.09337→0.09497 microseconds. Those small differences do not establish a speed improvement.
A separate cadence benchmark exercises the newly added sparse-input work:

| Input interval | Clean update, control→production, µs | Spike-stream update, control→production, µs |
| -------------- | -----------------------------------: | ------------------------------------------: |
| 1 ms           |                      0.06138→0.06081 |                             0.06132→0.06174 |
| 8.333 ms       |                      0.05606→0.09231 |                             0.05627→0.09286 |
| 16.667 ms      |                      0.05611→0.09221 |                             0.05636→0.09193 |
| 33 ms          |                      0.05061→0.08383 |                             0.05032→0.08543 |

Sparse updates cost 63–70% more, an additional 0.033–0.037 microseconds per call. Prediction
cost remains about 0.093 microseconds. Both timing protocols use three warmup and nine
measured rounds with rotating model order; reported values are medians of batch means.
Batch sizes differ, so compare each pair within its protocol. The cadence timing stream's
faults are per event and are used only to measure cost, not to estimate noise prevalence
or accuracy. No full application latency or DOM-layout performance claim follows.

Validation passed: 170 unit tests; 756 library, 102 framework, 198 web, and 37 lab browser
tests (1093 passed, two pre-existing intentional lab skips); build, typecheck, lint, format,
two quality checks, and eleven release checks. The package contains 51 files with no
benchmarks or research modules. The integrated predictor matched its selected source on
687420 updates/predictions and 257781 intersections across five configurations before the
final run. Source, gate, and selection hashes match the production development freeze.

Raw evidence is under
`/Users/hex/Documents/Research/hasta-filter-research-2026-11-14/iteration2/`:

- `evaluation/production-final.json` contains all final checks and trial-level action rows.
- `evaluation/production-final-summary.json` contains compact final metrics and tradeoffs.
- `evaluation/production-development.json` is the frozen production selection.
- `evaluation/production-external.json` and `evaluation/geometry-recent-cadence.json` record regression and independent cadence checks.
- `evaluation/production-performance.json` and `evaluation/production-perf-cadences.json` record CPU measurements; `evaluation/perf-cadences.mjs` reproduces the second protocol.
- `evaluation/production-source-verification.json` verifies final source fingerprints against disk.
- `root-audit/full-validation.json` and `root-audit/validation-logs/` preserve the complete test evidence.

The following development history retains the rejected hypotheses and explains why an
initial numerical improvement was insufficient. The earlier [FILTER-RESULTS.md](./FILTER-RESULTS.md)
records the first filter improvement against a different, older control.

| Candidate                                                 | Evidence                                                                                                               | Decision                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Logarithmic range reference                               | Old-corpus training: lower 120 ms mean, but short-horizon regression, median lead loss, and precision contract failure | Rejected                                                                                      |
| Observed braking 16/32 ms                                 | Balanced training 1152: 120 ms mean improvements 0.080%/0.216%; targeted subset 0.098%/0.565%                          | Rejected: benefit below predefined thresholds                                                 |
| Causal replay of provisional measurements, three variants | Exact reversal paths delay cancellation from 1060 to 1070 ms and lose a reapproach                                     | Rejected before aggregate training                                                            |
| Sparse geometry guard inflating measurement variance only | Balanced training 1152: 120 ms mean improves 2.90%                                                                     | Rejected: below the 5% threshold                                                              |
| Sparse geometry guard                                     | Balanced training 1152: primary and targeted thresholds passed                                                         | Advanced to independent development with an arithmetic guard for extreme configuration values |
| Sparse geometry guard with arithmetic correction          | Balanced development 4608 and external 156; numerical and action checks pass, one cadence precision episode fails      | Rejected: lost control-supported reapproach                                                   |
| Sparse geometry guard using recent measured speed         | Development 4608, old corpus 480, external 156, and independent cadence validation 4608 pass                           | Accepted after final holdout                                                                  |

The arithmetic correction handles an otherwise possible `0 * Infinity` in extreme
measurement-noise configurations. It changes no thresholds and matches the original
candidate exactly on 137,484 training updates. It was completed before the independent
development run.

For `geometry-s-guarded`, development 120 ms mean trace error fell from 44.2242 to 40.1103 px
(9.30%). The paired candidate-minus-control 95% interval was [−5.0958,−3.2164] px across 96
motion blocks. The targeted 8–17 ms timed-spike mean fell from 65.6884 to 50.1079 px (23.72%).
The pooled 120 ms p95 fell from 150.3857 to 134.3004 px. Short horizons, post-change error,
family/profile/cadence bounds, and forecast availability all passed their checks.

| Fixed 120 ms policy                   | Correct first actions | Wrong first actions | Aborts | Restarts |
| ------------------------------------- | --------------------: | ------------------: | -----: | -------: |
| Control, stability 30 ms              |                  2368 |                 400 |    611 |       40 |
| Candidate, stability 30 ms            |                  2377 |                 412 |    579 |       27 |
| Control, stability 0 ms, diagnostic   |                  2424 |                 992 |   2634 |     1275 |
| Candidate, stability 0 ms, diagnostic |                  2448 |                 937 |   2420 |     1173 |

These counts cover 4608 trials with 2880 selected-target trials. With 30 ms stability, wrong
first actions increase by 0.2604 percentage points, within the predefined 0.5-point allowance;
useful coverage increases by 0.3125 percentage points. Median lead among common-correct
trials is unchanged. Lower frame error therefore does not imply fewer wrong first actions
under every callback policy. Stability 0 ms is diagnostic and does not change acceptance.

The candidate is still rejected. In the narrow-channel path resampled at 1000/120 ms with
interval jitter, the control starts its later rightward episode at 1112 ms and the candidate
does not. The first observed rightward displacement is at 1084.1372 ms, making the control's
response 27.8628 ms. Both models already miss the intervening down phase, but preservation of
each individual control-supported episode was required in advance. Passing the original
three exact fixtures does not excuse this loss.

The old 480-trace regression corpus and external 156-trace corpus both pass. On the old
corpus 120 ms mean changes from 36.0694 to 35.9835 px; correct 257/wrong 47 and aborts 53 remain
unchanged. These results do not override the failed precision gate.

Auditable files for this decision:

- `iteration2/evaluation/geometry-s-guarded-development.json`
- `iteration2/evaluation/geometry-s-guarded-external.json`
- `iteration2/filter/geometry-s-guarded/` for the unchanged candidate sources
- `iteration2/filter/RESEARCH.md` for all five initial filter hypotheses and the later revisions
- `iteration2/runtime/` for discarded braking hypotheses and training evidence

The follow-up candidate `geometry-recent` changes the speed reference used to decide whether
an observed sparse displacement is implausible. It uses the larger of filtered speed and the
preceding measured segment speed when that segment is recent enough. The old candidate
mistook a real movement for an outlier because filtered speed still lagged after a turn.
The limits 6, 1.5, and 40 ms did not change. The new source was frozen before the next run.
Because the 960M development set had already been inspected, its second use is exploratory;
the separate 1080M cadence set supplied the next independent check. Both balanced and old
480-trace corpora use the same eight underlying motion families. Cadence validation changes
sampling frequencies and motion seeds, not the family definitions.

| Geometry-recent metric                   |     Development 960M |   Independent cadence 1080M |
| ---------------------------------------- | -------------------: | --------------------------: |
| Mean 120 ms error, control→candidate     |   44.2242→40.1128 px |          43.6137→39.4159 px |
| Relative improvement                     |                9.30% |                       9.62% |
| Paired 95% error interval                | [−5.0963,−3.2138] px |        [−5.0821,−3.3312] px |
| Pooled 120 ms p95                        | 150.3857→134.3004 px |        148.9942→129.0837 px |
| Targeted 8–17 ms timed-spike improvement |               23.69% | Different held-out cadences |
| Correct first actions, stability 30 ms   |            2368→2377 |                   2313→2310 |
| Wrong first actions, stability 30 ms     |              400→412 |                     427→440 |
| Aborts, stability 30 ms                  |              611→579 |                     729→687 |
| Correct first actions, stability 0 ms    |            2424→2448 |                   2311→2338 |
| Wrong first actions, stability 0 ms      |              992→937 |                   1073→1040 |
| Aborts, stability 0 ms                   |            2634→2420 |                   2855→2699 |

Every numerical, availability, action, and precision gate passes in both runs. The original
480-trace and external 156-trace regressions also pass. Both balanced runs have 4608 trials
and 2880 selected-target trials. In independent cadence validation, useful coverage falls
by 0.1042 percentage points and wrong first actions increase by 0.2821 points. These are
within the predefined limits, but they are costs of the candidate, not improvements.

For the 30 ms policy, all changed first-action counts occur with timed spikes; clean and
ordinary noisy profiles retain their counts. Development adds 12 wrong first actions in
the turn family. Cadence validation adds 10 in turns and 3 in pass-by cases. Among common
correct trials, 6/2363 starts are later in development, with a maximum 50 ms loss; 5/2303 are
later in cadence validation, each by at most 16.67 ms. Median common-correct lead is unchanged.
The 0 ms diagnostic has fewer wrong starts and aborts, illustrating why endpoint error and
callback-policy outcomes must be reported separately.

The additional files are `iteration2/evaluation/geometry-recent-development.json`,
`geometry-recent-cadence.json`, `geometry-recent-external.json`, and the corresponding
`*-summary.json` files. `seed-audit.json` records zero collisions between the 384 reserved
motion seeds and earlier study offsets using seed arithmetic only.
