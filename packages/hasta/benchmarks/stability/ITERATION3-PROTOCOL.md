Iteration 3 has two independent acceptance lanes. The frozen current control is
`5cf01cf9cd97dd2603a22143fbebaac95343da5d`, including the accepted sparse-input correction.
The older `0a503bb` control remains available to verify retention of previous numerical
gains. Both sides use the same current callback policy. No public modes, options, or ML
are added. These criteria are recorded before new-corpus candidate outcomes.

| Split                         | Definition                                                                                                |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Exploratory training          | `calibration`, offset 1560000000; 3 repetitions permitted for early rejection                             |
| Development selection         | `validation`, offset 1680000000; 12 repetitions                                                           |
| Additional cadence validation | `validation`, offset 1800000000; 12 repetitions; open only after selection                                |
| Final                         | `test`, offset 1920000000; 12 repetitions; never generate before full production checks and root approval |

The primary corpus keeps the iteration 2 balanced definition: eight motion families;
cadences 1, 4, 8, 1000/120, 12, 1000/60, 20, 33 ms; clean/noisy/timed-spike profiles; regular
and uniform ±35% interval jitter. This gives 4608 traces in 96 motion blocks. All cadence
and profile variants of one motion seed stay together. Additional cadence validation uses
6, 10, 14, 1000/90, 1000/144, 1000/75, 17, 24 ms and separate motion seeds. Timed-fault
scheduling retains the documented sampling-clock behavior, including dropping a fault
consumed on an unchanged position that produces no event. Old sets are seen regression
evidence.

Seed reservation is audited arithmetically against every prior recorded offset before
generation; no final positions or outcomes are computed during that audit. The complete
list includes 0, 70000000, 110000000, 150000000, 190000000, 240000000, 480000000, 720000000,
960000000, 1080000000, 1440000000. No recorded historical run has more than 12 repetitions.

The CPU lane requires exact forecast, rectangle-intersection, and callback-episode parity
with the frozen current control. It also requires the existing reset, same-time correction,
overflow, configured-noise, decimation, and precision contracts to hold. Acceptance requires
at least 15% lower median update time at each sparse interval 1000/120, 1000/60, and 33 ms,
for both clean and spike timing streams: all six pairs must pass. Dense 1 ms updates may
regress by no more than 5%. Prediction cost may regress by no more than 5% in every tested
cadence/profile pair, including dense input.

Timing requires two independent fresh-process runs after integration, using the same
frozen code and inputs. Each run must be isolated, use at least 3 warmup and 9 measured
rounds, and rotate model order. Both runs must pass all timing limits; report both without
selecting favorable rounds. Timing profiles measure cost only; their per-event faults are
not accuracy evidence.

Exact parity with `5cf01cf` retains its previous numerical and action behavior. Therefore a
CPU-only candidate's new-set comparison against `0a503bb` is reported, but sampling variation
in that older-control comparison is not a veto on a behavior-equivalent optimization.
A CPU-only optimization may ship even when the action-research lane fails. Performance
improvement never excuses a parity difference.

The action lane requires all of the following against `5cf01cf`:

- At fixed 120 ms horizon and 30 ms stability, wrong first actions decrease by at least 5%
  relative to control. The paired candidate-minus-control 95% bootstrap interval must be
  strictly below zero. Resample whole motion seeds within families, with 2000 replicates.
- Wrong first actions at fixed 120/0 do not increase. This diagnostic is reported separately
  from the primary 30 ms policy and cannot replace its improvement requirement.
- Useful action coverage falls by at most 0.25 percentage points. Median lead among
  common-correct trials falls by at most 2 ms. Report all delayed common-correct starts,
  aborts, restarts, and subgroup losses even when the gates pass.
- Overall 120 ms endpoint mean and pooled p95 do not regress. The targeted timed-spike subset
  also has no 120 ms mean or pooled p95 regression. The 160 ms pooled p95 does not regress.
- Mean error at 16/60 ms regresses by at most 1%; post-change mean at every horizon regresses
  by at most 2%. Existing family/profile/cadence bounds remain the larger of 10% and 2 px.
- Forecast availability remains identical; all exact and control-supported resampled
  precision episodes remain preserved. The existing 480-trace and external 156-trace
  regression checks remain mandatory.
- Previous gains against `0a503bb` remain: at least 5% lower overall 120 ms mean and at least
  10% lower targeted timed-spike 120 ms mean. These retention gates apply to every numerical
  or action-behavior change, including any combined candidate.

The targeted subset contains timed-spike traces with nominal cadence in the inclusive
8–17 ms interval. This is exactly 8, 1000/120, 12, and 1000/60 ms in the primary corpus.
In additional cadence validation it is 10, 1000/90, 1000/75, 14, and 17 ms.

Wrong first actions are defined by the synthetic selected-goal label. A geometric prediction
can correctly anticipate entry into a different, unselected target and still be scored
wrong. Report this distinction; abstention or degraded geometry must not be presented as
improved human-intent recognition. The endpoint, coverage, and lead constraints remain
mandatory.

Final evaluation requires a passing development selection with the same control, lane,
candidate identity, built production source, gates, and fingerprinted dependencies. The
final motion seeds must be disjoint from training, selection, and additional cadence sets.
Any source revision after a final outcome consumes that set and requires a new reservation.
No tuning on final outcomes is allowed. Full existing unit/browser/build/quality checks
remain required before final. All results are synthetic engineering evidence, not human
intent accuracy or whole-application latency claims.
