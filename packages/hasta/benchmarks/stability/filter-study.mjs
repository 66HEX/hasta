import { HORIZONS } from './corpus.mjs';
import { evaluateActions, forecastMetrics } from './evaluate.mjs';
import {
  FILTER_GATES,
  filterReport,
  pairedFilterComparison,
  assessFilter,
  actionRowsReport,
} from './filter-evaluation.mjs';

export const STUDY_CADENCES = Object.freeze([1, 4, 8, 1000 / 120, 12, 1000 / 60, 20, 33]);

export const VALIDATION_CADENCES = Object.freeze([
  6,
  10,
  14,
  1000 / 90,
  1000 / 144,
  1000 / 75,
  17,
  24,
]);

export const STUDY_PROFILES = Object.freeze(['clean', 'noisy', 'timed-spikes']);

export const STUDY_GATES = Object.freeze({
  ...FILTER_GATES,
  targetedMeanImprovement: 0.1,
  legacyMeanRegression: 0.01,
});

export function motionSeeds(split, repeats, offset) {
  const base = { calibration: 104729, validation: 32452843, test: 49979687 }[split];

  if (
    base === undefined ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(repeats) ||
    repeats < 1
  ) {
    throw new Error('Motion seed metadata requires a named split and integer offset/count.');
  }

  return Array.from({ length: 8 }, (_, family) =>
    Array.from(
      { length: repeats },
      (_value, repeat) => base + offset + family * 1009 + repeat * 100003,
    ),
  ).flat();
}

export function studyStage(stage, repeats = 12) {
  const stages = {
    training: { split: 'calibration', seedOffset: 960000000, cadences: STUDY_CADENCES },
    development: { split: 'validation', seedOffset: 960000000, cadences: STUDY_CADENCES },
    cadence: { split: 'validation', seedOffset: 1080000000, cadences: VALIDATION_CADENCES },
    final: { split: 'test', seedOffset: 1440000000, cadences: STUDY_CADENCES },
  };

  if (
    stages[stage] === undefined ||
    ![3, 12].includes(repeats) ||
    (stage !== 'training' && repeats !== 12)
  ) {
    throw new Error('Use a named study stage with12 repetitions; only training permits3.');
  }

  return { ...stages[stage], repeats };
}

export function compactReplay(replay) {
  const { id, block, family, profile, cadence, jitter } = replay.trace;

  return {
    trace: { id, block, family, profile, cadence, jitter },
    errors: replay.errors.map(({ horizon, errorPx, postChange }) => ({
      horizon,
      errorPx,
      postChange,
    })),
    frames: replay.frames.map((frame) => ({
      eligible: frame.eligible,
      forecasts: Object.fromEntries(
        HORIZONS.map((horizon) => [horizon, frame.forecasts[horizon] === null ? null : true]),
      ),
    })),
    action: evaluateActions(
      replay,
      { horizonMs: 120, stableForMs: 30, evidence: 'fresh' },
      1,
      true,
    ),
    immediate: evaluateActions(
      replay,
      { horizonMs: 120, stableForMs: 0, evidence: 'fresh' },
      1,
      true,
    ),
  };
}

export function studyReport(replays, profiles = STUDY_PROFILES) {
  return {
    ...filterReport(
      replays,
      profiles,
      replays.map((replay) => replay.action),
    ),
    immediateDiagnostic: actionRowsReport(
      replays.map((replay) => replay.immediate),
      { horizonMs: 120, stableForMs: 0, evidence: 'fresh' },
      profiles,
    ),
  };
}

export function assessStudy(control, candidate, nonInferiority = false) {
  const reports = { control: studyReport(control), candidate: studyReport(candidate) };
  const paired = pairedFilterComparison(control, candidate, reports.control, reports.candidate);
  const acceptance = assessFilter(reports.control, reports.candidate, paired, nonInferiority);
  const byCadenceProfile = {};

  for (const key of ['cadence', 'cadenceProfile']) {
    const groupKey = ({ trace }) =>
      `${trace.cadence}/${trace.jitter ? 'jitter' : 'regular'}${key === 'cadenceProfile' ? `/${trace.profile}` : ''}`;

    const beforeGroups = Map.groupBy(control, groupKey);
    const afterGroups = Map.groupBy(candidate, groupKey);
    byCadenceProfile[key] = {};

    for (const [name, before] of beforeGroups) {
      const original = forecastMetrics(before);
      const updated = forecastMetrics(afterGroups.get(name));
      byCadenceProfile[key][name] = { control: original, candidate: updated };

      for (const [index, row] of original.entries()) {
        const after = updated[index];
        const limit = row.meanTraceErrorPx + Math.max(2, row.meanTraceErrorPx * 0.1);
        acceptance.checks.push(
          {
            name: `${key}/${name}/${row.horizonMs}ms mean regression`,
            actual: after.meanTraceErrorPx,
            limit,
            passes: after.meanTraceErrorPx <= limit,
          },
          {
            name: `${key}/${name}/${row.horizonMs}ms availability preserved`,
            actual: after.forecastFrames,
            limit: row.forecastFrames,
            passes: after.forecastFrames === row.forecastFrames,
          },
        );
      }
    }
  }

  const targeted = (replays) =>
    forecastMetrics(
      replays.filter(
        ({ trace }) =>
          trace.profile === 'timed-spikes' &&
          [8, 1000 / 120, 12, 1000 / 60].includes(trace.cadence),
      ),
    ).find((row) => row.horizonMs === 120);

  const target = { control: targeted(control), candidate: targeted(candidate) };

  if (!nonInferiority) {
    const limit = target.control.meanTraceErrorPx * (1 - STUDY_GATES.targetedMeanImprovement);
    acceptance.checks.push({
      name: 'targeted8–17ms timed spikes improve120ms mean by at least10%',
      actual: target.candidate.meanTraceErrorPx,
      limit,
      passes:
        target.candidate.meanTraceErrorPx !== null && target.candidate.meanTraceErrorPx <= limit,
    });
  }

  acceptance.passes = acceptance.checks.every((check) => check.passes);

  return { models: reports, paired, byCadenceProfile, targeted: target, acceptance };
}
