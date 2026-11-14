The production CPU optimization passed against the accepted predictor at
`5cf01cf9cd97dd2603a22143fbebaac95343da5d`. Two isolated fresh-process confirmations measured
29.96–33.98% lower update times for the six sparse cadence/profile pairs, saving
0.0253–0.0295 microseconds per update. All 647 final checks passed on 4608 reserved traces:
746652 forecasts and 4387320 rectangle intersections were exactly unchanged, as were
availability and callback episodes. Wrong first actions remain 507 at stability 30 ms and
1085 at stability 0 ms. This iteration improves execution cost, with no accuracy or action
improvement claimed.

The [preregistered protocol](./ITERATION3-PROTOCOL.md) permits independent CPU acceptance
when action research fails. All three action hypotheses were rejected on training data;
none consumed validation or final data. No numerical thresholds or public API changed.

The CPU change avoids expensive magnitude calculations only when a conservative squared
comparison proves the same result as the original condition. Boundary, subnormal, overflow,
and uncertain cases retain the original calculation. The authoritative speed threshold
and measurement weighting remain unchanged. This preserves the previous numerical
improvement while reducing the cost of applying it.

| Independent production check                      | Development | Additional cadence | Final holdout |
| ------------------------------------------------- | ----------: | -----------------: | ------------: |
| Seed offset                                       |  1680000000 |         1800000000 |    1920000000 |
| Traces                                            |        4608 |               4608 |          4608 |
| Forecast outputs checked exactly                  |      762768 |             761868 |        746652 |
| Rectangle intersections checked exactly           |     4488048 |            4478616 |       4387320 |
| Query differences                                 |           0 |                  0 |             0 |
| Action-episode differences, stability 30 and 0 ms |           0 |                  0 |             0 |
| Availability differences                          |           0 |                  0 |             0 |

The additional 480-trace regression set has zero differences in all three runs. The historical
156-trace external regression also passes. All exact and resampled precision contracts
remain preserved. Against the older `0a503bb` reference, the development set reports an
8.57% lower overall 120 ms mean and a 21.19% lower targeted timed-spike mean; cadence
validation reports 10.81% and 25.50%; final reports 8.66% and 23.43%. These are retained
behavior from the prior study, not new accuracy gains from CPU optimization. The final
set was opened only after production checks and both CPU confirmations passed. It shares
no motion seeds with development; the synthetic motion families remain the same.

Final fixed 120/30 actions are identical: 2141 correct, 507 wrong, and 1960 abstentions;
useful coverage is 74.34% of selected-target trials, with median lead 76.33 ms. The 120/0
diagnostic is also identical: 2295 correct, 1085 wrong, and 1228 abstentions; coverage
79.69%, median lead 116.87 ms. Post-change errors, endpoint tails, and all subgroup results
are unchanged because the actual forecast values match exactly.

| Sparse cadence/profile | Update improvement, run 1 |  Run 2 |
| ---------------------- | ------------------------: | -----: |
| 8.333 ms, clean        |                    32.15% | 31.29% |
| 8.333 ms, spike        |                    30.39% | 30.08% |
| 16.667 ms, clean       |                    31.71% | 31.52% |
| 16.667 ms, spike       |                    31.13% | 30.55% |
| 33 ms, clean           |                    33.98% | 32.22% |
| 33 ms, spike           |                    31.31% | 29.96% |

Sparse update medians changed from 0.0838–0.0936 to 0.0568–0.0652 microseconds per call.
Dense clean updates improved by 0.93% and 0.53%; dense spike updates cost 1.77% and 2.47%
more. Prediction changes across every tested pair range from −0.595% to +0.453%. Both
confirmations pass every preregistered timing gate, with identical source and script hashes.

Measurements used Node v24.20.0 on an Apple M4 Pro. No benchmark, test, or build jobs ran
concurrently; ordinary desktop applications remained open. These results measure the
filter methods in Node, rather than browser rendering or complete pointer-event handling.

Timing confirmation uses the same frozen production script for both fresh processes.
Before either confirmation, the prediction batch was increased from the exploratory
200000 calls to 1000000 calls to reduce short-batch noise. Inputs, rotating order, three
warmup rounds, nine measured rounds, and all acceptance limits stay unchanged. Each of
six sparse cadence/profile pairs had to improve update median by at least 15%; dense update
and every prediction pair could regress by no more than 5%.

| Research candidate                             | Evidence                                                                              | Decision                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------- |
| Short-circuit predicate ordering               | Exact outputs; exploratory sparse update gains about 10.7–14.7%                       | Rejected: below the 15% CPU threshold |
| Conservative sufficient-squared comparison     | Exact development, cadence, and final outputs; both production CPU confirmations pass | Accepted                              |
| Trusted recent speed for sparse classification | Training 1152: wrong first actions 139→139 at 30 ms and 290→290 at 0 ms               | Rejected: no action benefit           |
| Direction-aware recent speed                   | Same wrong-action counts; 120 ms endpoint mean changes by about +0.000835%            | Rejected: no action benefit           |
| Posterior-step speed reference                 | Same wrong-action counts and aggregate endpoint metrics                               | Rejected: no action benefit           |

The action diagnosis explains an evaluation limit. All 416 wrong first actions in the
previous final 120/30 result anticipated an actual geometric entry into that unselected
target within the horizon. The selected-goal label still classifies them as wrong. A
better geometric estimate alone cannot resolve which entered target the user intends to
choose. This does not excuse changing the action criteria or suppressing useful predictions
to improve a score. The tested hypotheses did not satisfy those criteria.

An initial parity-digest prototype used noncanonical V8 serialization. A smoke test comparing
identical models detected differing serialized representations. That artifact is retained
as `sufficient-squared-development-harness-invalid.json` and is excluded from candidate
evidence. The corrected digest canonically encodes Float64 values, including signed zero;
focused tests cover repeated numeric representations, subnormal changes, and changed
callback episodes. No model parameter or acceptance threshold changed because of this
harness correction.

Root validation passed: 179 unit tests; 1093 browser tests with two pre-existing intentional
lab skips; build, typecheck, lint, format, two quality checks, and eleven release checks.
The package has 51 files and excludes benchmark/research code. Independent source audits
also cover exact candidate/production parity, configured noise, same-time corrections,
resets, overflow, and the conservative comparison's floating-point boundaries.

Evidence is stored under
`/Users/hex/Documents/Research/hasta-filter-research-2026-11-14/iteration3/`:

- `evaluation/production-final.json`, `production-development.json`, `production-cadence.json`, and `production-external.json`.
- `evaluation/seed-audit.json`, generated using seed arithmetic without final trajectories.
- `evaluation/final-verification.json` confirms all 43 source fingerprints, the development selection hash, unchanged gates, disjoint development/cadence seeds, and matching timing sources.
- `cpu/` contains frozen candidates, predicate/parity audits, and exploratory timing.
- `actions/NOTES.md`, training JSON, and `contact-leads.json` record rejected hypotheses and the geometric-entry diagnosis.
- `root-audit/production-perf.mjs`, `production-perf-1.json`, `production-perf-2.json`, and `performance-acceptance.json` preserve the confirmation script, both measurements, and every timing gate.
- `root-audit/full-validation.json` and `root-audit/validation-logs/` preserve the complete test evidence.

These are synthetic engineering checks and isolated microbenchmarks, not measurements of
human intent or whole-application latency.
