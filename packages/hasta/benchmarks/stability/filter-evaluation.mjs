import { randomSource } from '../comparison/corpus.mjs';
import { HORIZONS, FAMILIES, PROFILES } from './corpus.mjs';
import { aggregateActions, evaluateActions, forecastMetrics, summarize } from './evaluate.mjs';

export const FILTER_GATES = Object.freeze({
  primaryHorizonMs: 120,
  minimumMeanImprovement: 0.05,
  shortHorizonMeanRegression: 0.02,
  familyProfileRelativeRegression: 0.1,
  familyProfileAbsoluteRegressionPx: 2,
  postChangeMeanRegression: 0.05,
  wrongFirstRegressionPercentagePoints: 0.5,
  usefulCoverageRegressionPercentagePoints: 1,
  commonCorrectMedianLeadRegressionMs: 5,
  bootstrapReplicates: 2000,
});

const mean = (values) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

export function validateSelectionProtocol(current, selected) {
  if (current.stage !== 'final' || selected.stage !== 'development') {
    throw new Error('Final evaluation requires a development selection artifact.');
  }

  for (const field of ['version', 'candidate', 'candidateModule', 'repeats']) {
    if (current[field] !== selected[field]) {
      throw new Error(`Selection protocol changed: ${field}.`);
    }
  }

  for (const field of ['gates', 'sourceSha256']) {
    const keys = Object.keys(current[field]);

    if (
      keys.length !== Object.keys(selected[field]).length ||
      keys.some((key) => current[field][key] !== selected[field][key])
    ) {
      throw new Error(`Selection protocol changed: ${field}.`);
    }
  }

  if (current.traceIds.length === 0 || selected.traceIds.length === 0) {
    throw new Error('Selection and final evaluation must include traces.');
  }

  const seeds = new Set(selected.traceIds.map((id) => id.split('/').at(-1)));

  if (current.traceIds.some((id) => seeds.has(id.split('/').at(-1)))) {
    throw new Error('Selection and final evaluation must use disjoint motion seeds.');
  }
}

export function actionReport(replays, policy) {
  const rows = replays.map((replay) =>
    policy === null
      ? {
          id: replay.trace.id,
          family: replay.trace.family,
          profile: replay.trace.profile,
          selected: replay.trace.selected !== null,
          correct: 0,
          wrong: 0,
          abstained: 1,
          leadMs: null,
          actions: 0,
          wrongStarts: 0,
          aborts: 0,
          restarts: 0,
        }
      : evaluateActions(replay, policy),
  );

  return {
    policy,
    metrics: aggregateActions(rows),
    byFamily: Object.fromEntries(
      FAMILIES.map((family) => [
        family,
        aggregateActions(rows.filter((row) => row.family === family)),
      ]),
    ),
    byProfile: Object.fromEntries(
      PROFILES.map((profile) => [
        profile,
        aggregateActions(rows.filter((row) => row.profile === profile)),
      ]),
    ),
    rows,
  };
}

export function filterReport(replays) {
  return {
    forecast: forecastMetrics(replays),
    forecastByFamily: Object.fromEntries(
      FAMILIES.map((family) => [
        family,
        forecastMetrics(replays.filter(({ trace }) => trace.family === family)),
      ]),
    ),
    forecastByProfile: Object.fromEntries(
      PROFILES.map((profile) => [
        profile,
        forecastMetrics(replays.filter(({ trace }) => trace.profile === profile)),
      ]),
    ),
    fixed: actionReport(replays, { horizonMs: 120, stableForMs: 30, evidence: 'fresh' }),
  };
}

export function pairedMotionInterval(rows, field = 'difference') {
  const blocks = new Map();

  for (const row of rows) {
    const block = blocks.get(row.block) ?? { family: row.family, values: [] };
    block.values.push(row[field]);
    blocks.set(row.block, block);
  }

  const families = new Map();

  for (const block of blocks.values()) {
    const family = families.get(block.family) ?? [];
    family.push(mean(block.values));
    families.set(block.family, family);
  }

  if (blocks.size === 0) {
    return { blocks: 0, difference: null, lower95: null, upper95: null };
  }

  const random = randomSource(0x6a09e667);
  const draws = [];

  for (let repetition = 0; repetition < FILTER_GATES.bootstrapReplicates; repetition++) {
    const sampled = [];

    for (const family of families.values()) {
      for (let index = 0; index < family.length; index++) {
        sampled.push(family[Math.floor(random.uniform() * family.length)]);
      }
    }

    draws.push(mean(sampled));
  }

  draws.sort((a, b) => a - b);

  return {
    blocks: blocks.size,
    difference: mean([...blocks.values()].map((block) => mean(block.values))),
    lower95: draws[Math.floor((draws.length - 1) * 0.025)],
    upper95: draws[Math.floor((draws.length - 1) * 0.975)],
  };
}

export function pairedFilterComparison(control, candidate, controlReport, candidateReport) {
  const controlById = new Map(control.map((replay) => [replay.trace.id, replay]));

  const endpoint = HORIZONS.map((horizonMs) => {
    const rows = candidate.flatMap((replay) => {
      const before = controlById.get(replay.trace.id);
      const errors = (entry) => entry.errors.filter((error) => error.horizon === horizonMs);
      const original = mean(errors(before).map((error) => error.errorPx));
      const updated = mean(errors(replay).map((error) => error.errorPx));

      return original === null || updated === null
        ? []
        : [
            {
              block: replay.trace.block,
              family: replay.trace.family,
              difference: updated - original,
            },
          ];
    });

    return { horizonMs, ...pairedMotionInterval(rows) };
  });

  const originalActions = new Map(controlReport.fixed.rows.map((row) => [row.id, row]));
  const traceById = new Map(candidate.map((replay) => [replay.trace.id, replay.trace]));

  const actions = candidateReport.fixed.rows.map((row) => {
    const original = originalActions.get(row.id);
    const trace = traceById.get(row.id);

    return {
      block: trace.block,
      family: trace.family,
      wrongDifference: row.wrong - original.wrong,
      correctDifference: row.correct - original.correct,
      commonLeadDifference: row.correct && original.correct ? row.leadMs - original.leadMs : null,
    };
  });

  return {
    method:
      'Paired candidate-minus-control differences, mean across profiles within each motion seed; 2000 percentile bootstrap draws resample motion seeds within each family. Frames and profiles are not independent observations.',
    endpoint,
    wrongFirstFraction: pairedMotionInterval(actions, 'wrongDifference'),
    correctFirstFractionOfAllTrials: pairedMotionInterval(actions, 'correctDifference'),
    commonCorrectLeadDifferenceMs: summarize(
      actions.flatMap((row) =>
        row.commonLeadDifference === null ? [] : [row.commonLeadDifference],
      ),
    ),
  };
}

export function assessFilter(control, candidate, paired) {
  const checks = [];
  const metric = (report, horizon) => report.forecast.find((row) => row.horizonMs === horizon);

  const check = (name, actual, limit, passes = actual <= limit) => {
    checks.push({ name, actual, limit, passes });
  };

  const primary = metric(control, FILTER_GATES.primaryHorizonMs).meanTraceErrorPx;

  check(
    '120ms mean trace error improves by at least 5%',
    metric(candidate, 120).meanTraceErrorPx,
    primary * (1 - FILTER_GATES.minimumMeanImprovement),
  );

  const interval = paired.endpoint.find((row) => row.horizonMs === 120);
  check('120ms paired error interval excludes zero', interval.upper95, 0, interval.upper95 < 0);

  for (const horizon of HORIZONS) {
    const before = metric(control, horizon);
    const after = metric(candidate, horizon);

    check(
      `${horizon}ms forecast availability preserved`,
      after.forecastFrames,
      before.forecastFrames,
      after.forecastFrames === before.forecastFrames,
    );

    check(
      `${horizon}ms post-change mean regression at most 5%`,
      after.postChangeErrorPx.mean,
      before.postChangeErrorPx.mean * (1 + FILTER_GATES.postChangeMeanRegression),
    );

    if (horizon <= 60) {
      check(
        `${horizon}ms mean error regression at most 2%`,
        after.meanTraceErrorPx,
        before.meanTraceErrorPx * (1 + FILTER_GATES.shortHorizonMeanRegression),
      );
    } else {
      check(
        `${horizon}ms pooled p95 does not regress`,
        after.endpointErrorPx.p95,
        before.endpointErrorPx.p95,
      );
    }
  }

  for (const group of ['forecastByFamily', 'forecastByProfile']) {
    for (const [name, rows] of Object.entries(control[group])) {
      for (const before of rows) {
        const after = candidate[group][name].find((row) => row.horizonMs === before.horizonMs);

        const allowance = Math.max(
          FILTER_GATES.familyProfileAbsoluteRegressionPx,
          before.meanTraceErrorPx * FILTER_GATES.familyProfileRelativeRegression,
        );

        check(
          `${group}/${name}/${before.horizonMs}ms mean regression`,
          after.meanTraceErrorPx,
          before.meanTraceErrorPx + allowance,
        );
      }
    }
  }

  const before = control.fixed.metrics;
  const after = candidate.fixed.metrics;

  check(
    'wrong first actions regression at most 0.5 percentage points',
    after.wrongPer100,
    before.wrongPer100 + FILTER_GATES.wrongFirstRegressionPercentagePoints,
  );

  check(
    'useful action coverage loss at most 1 percentage point',
    (before.usefulCoverage - after.usefulCoverage) * 100,
    FILTER_GATES.usefulCoverageRegressionPercentagePoints,
    after.usefulCoverage >=
      before.usefulCoverage - FILTER_GATES.usefulCoverageRegressionPercentagePoints / 100,
  );

  const lead = paired.commonCorrectLeadDifferenceMs.median;

  check(
    'common-correct median lead loss at most 5ms',
    lead,
    -FILTER_GATES.commonCorrectMedianLeadRegressionMs,
    lead !== null && lead >= -FILTER_GATES.commonCorrectMedianLeadRegressionMs,
  );

  return { passes: checks.every((entry) => entry.passes), checks };
}
