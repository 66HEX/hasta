import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { forecastMetrics } from './evaluate.mjs';
import { STUDY_CADENCES, VALIDATION_CADENCES, assessStudy, motionSeeds } from './filter-study.mjs';

export const ITERATION3_GATES = Object.freeze({
  wrongFirstRelativeImprovement: 0.05,
  coverageLossPercentagePoints: 0.25,
  commonMedianLeadLossMs: 2,
  shortMeanRegression: 0.01,
  postChangeRegression: 0.02,
  retainedOverallImprovement: 0.05,
  retainedTargetedImprovement: 0.1,
  sparseUpdateImprovement: 0.15,
  denseUpdateRegression: 0.05,
  predictionRegression: 0.05,
  timingWarmups: 3,
  timingMeasuredRounds: 9,
  timingConfirmationRuns: 2,
  familyProfileRelativeRegression: 0.1,
  familyProfileAbsoluteRegressionPx: 2,
  bootstrapReplicates: 2000,
});

function canonical(value) {
  const bytes = Buffer.allocUnsafe(8);

  return JSON.stringify(value, (_key, item) => {
    if (Number.isFinite(item)) {
      bytes.writeDoubleLE(item);

      return `float64:${bytes.toString('hex')}`;
    }

    return item === undefined ? 'undefined-value' : item;
  });
}

export function iteration3Stage(stage, repeats = 12) {
  const configurations = {
    training: { split: 'calibration', seedOffset: 1560000000, cadences: STUDY_CADENCES },
    development: { split: 'validation', seedOffset: 1680000000, cadences: STUDY_CADENCES },
    cadence: { split: 'validation', seedOffset: 1800000000, cadences: VALIDATION_CADENCES },
    final: { split: 'test', seedOffset: 1920000000, cadences: STUDY_CADENCES },
  };

  if (
    !configurations[stage] ||
    ![3, 12].includes(repeats) ||
    (stage !== 'training' && repeats !== 12)
  ) {
    throw new Error('Use a named iteration3 stage with12 repetitions; training alone permits3.');
  }

  const configuration = configurations[stage];

  return {
    ...configuration,
    repeats,
    motionSeeds: motionSeeds(configuration.split, repeats, configuration.seedOffset),
  };
}

export function recordingFactory(factory) {
  const queries = createHash('sha256');
  const availability = createHash('sha256');
  const counts = { updates: 0, resets: 0, predictions: 0, intersections: 0 };

  return {
    create() {
      const model = factory();

      return {
        update(sample) {
          counts.updates++;
          model.update(sample);
        },
        reset() {
          counts.resets++;
          model.reset();
        },
        predict(now, horizon) {
          const result = model.predict(now, horizon);
          counts.predictions++;
          queries.update(canonical(['predict', now, horizon, result]));
          availability.update(canonical([now, horizon, result !== null]));

          return result;
        },
        intersectRect(now, horizon, rect) {
          const result = model.intersectRect(now, horizon, rect);
          counts.intersections++;
          queries.update(canonical(['intersection', now, horizon, rect, result]));

          return result;
        },
      };
    },
    finish(action, immediate) {
      return {
        ...counts,
        querySha256: queries.digest('hex'),
        availabilitySha256: availability.digest('hex'),
        actionsSha256: createHash('sha256')
          .update(canonical([action, immediate]))
          .digest('hex'),
      };
    },
  };
}

export function paritySummary(rows) {
  return {
    traces: rows.length,
    predictions: rows.reduce((sum, row) => sum + row.control.predictions, 0),
    intersections: rows.reduce((sum, row) => sum + row.control.intersections, 0),
    queryMismatches: rows
      .filter((row) => row.control.querySha256 !== row.candidate.querySha256)
      .map((row) => row.id),
    actionMismatches: rows
      .filter((row) => row.control.actionsSha256 !== row.candidate.actionsSha256)
      .map((row) => row.id),
    availabilityMismatches: rows
      .filter((row) => row.control.availabilitySha256 !== row.candidate.availabilitySha256)
      .map((row) => row.id),
  };
}

const targeted = (replays) =>
  forecastMetrics(
    replays.filter(
      ({ trace }) => trace.profile === 'timed-spikes' && trace.cadence >= 8 && trace.cadence <= 17,
    ),
  ).find((row) => row.horizonMs === 120);

export function assessIteration3(control, candidate, reference, lane, parity) {
  const report = assessStudy(control, candidate, true);

  const check = (name, actual, limit, passes = actual <= limit) =>
    report.acceptance.checks.push({ name, actual, limit, passes });

  const before = report.models.control;
  const after = report.models.candidate;
  report.targeted = {
    control: targeted(control),
    candidate: targeted(candidate),
    reference: targeted(reference),
  };

  const oldOverall = forecastMetrics(reference).find(
    (row) => row.horizonMs === 120,
  ).meanTraceErrorPx;

  const currentOverall = after.forecast.find((row) => row.horizonMs === 120).meanTraceErrorPx;
  report.retainedGains = {
    referenceControl: '0a503bb',
    overallImprovement: 1 - currentOverall / oldOverall,
    targetedImprovement:
      1 - report.targeted.candidate.meanTraceErrorPx / report.targeted.reference.meanTraceErrorPx,
    requiredForAcceptance: lane === 'actions',
  };
  report.parity = parity;
  check('forecast availability identical per query', parity.availabilityMismatches.length, 0);

  if (lane === 'cpu') {
    check(
      'CPU candidate forecasts and intersections exactly match5cf01cf',
      parity.queryMismatches.length,
      0,
    );
    check('CPU candidate action episodes exactly match5cf01cf', parity.actionMismatches.length, 0);
  } else if (lane === 'actions') {
    check(
      'wrong first actions improve by at least5%',
      after.fixed.metrics.wrongPer100,
      before.fixed.metrics.wrongPer100 * 0.95,
    );
    check(
      'paired wrong-first95% interval excludes zero',
      report.paired.wrongFirstFraction.upper95,
      0,
      report.paired.wrongFirstFraction.upper95 !== null &&
        report.paired.wrongFirstFraction.upper95 < 0,
    );
    check(
      'fixed120/0 wrong first actions do not increase',
      after.immediateDiagnostic.metrics.wrong,
      before.immediateDiagnostic.metrics.wrong,
    );
    check(
      'useful coverage loss at most0.25 percentage points',
      (before.fixed.metrics.usefulCoverage - after.fixed.metrics.usefulCoverage) * 100,
      0.25,
    );
    const lead = report.paired.commonCorrectLeadDifferenceMs.median;
    check('common-correct median lead loss at most2ms', lead, -2, lead !== null && lead >= -2);

    for (const [index, row] of before.forecast.entries()) {
      const updated = after.forecast[index];

      if (row.horizonMs <= 120) {
        check(
          `${row.horizonMs}ms endpoint mean constraint`,
          updated.meanTraceErrorPx,
          row.meanTraceErrorPx * (row.horizonMs < 120 ? 1.01 : 1),
        );
      }

      check(
        `${row.horizonMs}ms post-change regression at most2%`,
        updated.postChangeErrorPx.mean,
        row.postChangeErrorPx.mean * 1.02,
      );
    }

    check(
      'targeted120ms mean does not regress',
      report.targeted.candidate.meanTraceErrorPx,
      report.targeted.control.meanTraceErrorPx,
    );
    check(
      'targeted120ms p95 does not regress',
      report.targeted.candidate.endpointErrorPx.p95,
      report.targeted.control.endpointErrorPx.p95,
    );
    check(
      'retain at least5% overall improvement against0a503bb',
      report.retainedGains.overallImprovement,
      0.05,
      report.retainedGains.overallImprovement >= 0.05,
    );
    check(
      'retain at least10% targeted improvement against0a503bb',
      report.retainedGains.targetedImprovement,
      0.1,
      report.retainedGains.targetedImprovement >= 0.1,
    );
  } else {
    throw new Error('Unknown iteration3 acceptance lane.');
  }

  report.acceptance.passes = report.acceptance.checks.every((entry) => entry.passes);

  return report;
}
