This second filter study compares candidates with the accepted Hasta implementation at
`0a503bbc60adfdece2ca42f06a67b0254966c93b`. It does not compare with the original filter from
`fa9ac8d`. Both sides use the same current callback policy. Production gains require no ML,
new public modes, or new public options.

The primary corpus was specified before balanced-corpus candidate measurements. The reason
for changing the primary corpus is known sampling coverage: the old outlier profile uses
4 ms samples, while independent diagnostics exposed a weakness at 8–17 ms.
The old corpus remains a required non-inferiority check. This decision must not be changed
after candidate results are inspected. Exploratory training results remain development
evidence, including rejected candidates.

| Component                     | Frozen definition                                                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Training                      | `calibration`, seed offset 960000000                                                                                                                                                                                   |
| Development selection         | `validation`, seed offset 960000000                                                                                                                                                                                    |
| Additional cadence validation | `validation`, seed offset 1080000000; run only after a candidate is selected on development                                                                                                                            |
| Final holdout                 | `test`, seed offset 1440000000; do not generate or replay before production approval                                                                                                                                   |
| Motion blocks                 | Eight existing motion families × 12 seeds, with all measurement variants inside each block                                                                                                                             |
| Primary cadence               | 1, 4, 8, 1000/120, 12, 1000/60, 20, 33 ms                                                                                                                                                                              |
| Primary profile               | Clean, Gaussian noise with sigma 0.35 px, timed spikes with the same noise plus sigma 24 px faults                                                                                                                     |
| Timing                        | Regular and independent interval jitter uniformly distributed between 0.65 and 1.35 times the nominal interval                                                                                                         |
| Timed faults                  | Fault times spaced uniformly 80–240 ms, independent of cadence. The first sampling-clock tick at or after a fault consumes it; if that tick has unchanged truth and produces no pointer event, the fault is discarded. |
| Primary size                  | 4608 traces, equal contribution per trace, paired inference over 96 whole motion seeds                                                                                                                                 |
| Cadence validation            | 6, 10, 14, 1000/90, 1000/144, 1000/75, 17, 24 ms with the same profiles, timing variants, and 12 seeds                                                                                                                 |

The error at 120 ms must improve by at least 5% and its paired 95% bootstrap interval
(candidate minus control) must be strictly below zero. Bootstrap resampling preserves
families and keeps all profiles and cadences for a motion seed together. There are 2000
bootstrap replicates. The targeted timed-spike subset at 8, 1000/120, 12, and 1000/60 ms
must collectively improve its 120 ms mean by at least 10%.

All of the following remain mandatory:

- At 16 and 60 ms, mean trace error may increase by at most 2%.
- Pooled endpoint p95 at 120 and 160 ms must not increase.
- At every horizon, post-change mean may increase by at most 5%.
- At every horizon, each family, profile, cadence, and cadence/profile group may regress
  by at most the larger of 10% and 2 px. Regular and jittered cases are reported separately.
- Forecast availability must be identical at every horizon, including each cadence group.
- With the fixed existing 120 ms horizon and 30 ms stability policy, wrong first actions
  may increase by at most 0.5 percentage points, useful action coverage may fall by at most
  1 percentage point, and median lead among common-correct trials may fall by at most 5 ms.
- The original 480-trace corpus must pass the same non-inferiority checks and a 120 ms mean
  regression limit of 1%. It does not need to improve by 5%.
- Exact narrow-channel/reversal contracts must pass. On resampled precision paths, every
  control-supported episode must remain within its original phase deadline, with no new
  wrong-lane start. Report response from first changed observation; no universal 8 or 32 ms
  response guarantee is inferred.
- Existing unit and browser contracts must pass before final holdout evaluation. The
  final run must use the same approved production sources and frozen development policy.

Availability, actions, and tails are separate checks; frame error must not be presented as
action accuracy. Report ordinary late starts, aborts, and restarts even when their aggregate
gate passes. External historical comparison data remain an additional regression check,
not unseen evidence. Report CPU cost after a candidate has passed quality checks.

Final evaluation refuses a different control, candidate module, source fingerprint, gates,
or overlapping motion seeds. No parameter tuning is allowed on the final set. A production
revision after opening that set consumes it and requires a newly reserved holdout. These
are synthetic engineering criteria, not evidence of human intent or real-world efficacy.

Documentation correction after the first development run: timed faults have always been
consumed before stationary/quantized samples are skipped. The table now states that behavior
explicitly. No samples, thresholds, or acceptance criteria changed. Fault rates per delivered
event therefore vary with silence and quantization even though scheduled times are independent
of cadence.
