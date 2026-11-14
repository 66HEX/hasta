import assert from 'node:assert/strict';
import test from 'node:test';

import { KalmanPredictor as ControlPredictor } from '../benchmarks/stability/baseline-fa9ac8d/core/prediction/kalman-predictor.js';
import {
  pairedMotionInterval,
  assessFilter,
  validateSelectionProtocol,
} from '../benchmarks/stability/filter-evaluation.mjs';
import { precisionReport } from '../benchmarks/stability/filter-scenarios.mjs';

test('frozen predictor satisfies the exact narrow-channel and reversal browser episode contracts', () => {
  const result = precisionReport(() => new ControlPredictor());
  assert.equal(result.passes, true);
  assert.equal(result.scenarios.length, 3);
  assert.deepEqual(
    result.scenarios[0].episodes.map((episode) => episode.at),
    [1010, 1050, 1112],
  );
});

test('paired intervals keep correlated profiles inside each motion seed', () => {
  const first = { block: 'seed1', family: 'straight', difference: 1 };
  const second = { block: 'seed2', family: 'straight', difference: 9 };
  const original = pairedMotionInterval([first, second]);
  const duplicated = pairedMotionInterval([...Array.from({ length: 50 }, () => first), second]);
  assert.equal(original.blocks, 2);
  assert.equal(original.difference, 5);
  assert.deepEqual(duplicated, original);
});

function report(error) {
  return {
    forecast: [16, 60, 120, 160].map((horizonMs) => ({
      horizonMs,
      meanTraceErrorPx: error,
      endpointErrorPx: { p95: error * 2 },
      postChangeErrorPx: { mean: error },
      forecastFrames: 10,
    })),
    forecastByFamily: {},
    forecastByProfile: {},
    fixed: { metrics: { wrongPer100: 5, usefulCoverage: 0.8 } },
  };
}

const paired = {
  endpoint: [{ horizonMs: 120, upper95: -2 }],
  commonCorrectLeadDifferenceMs: { median: 0 },
};

test('acceptance vetoes loss of forecasts, tail regressions and action harm despite mean improvement', () => {
  const control = report(100);
  const candidate = report(90);
  assert.equal(assessFilter(control, candidate, paired).passes, true);
  candidate.forecast[0].forecastFrames = 9;
  assert.equal(assessFilter(control, candidate, paired).passes, false);
  candidate.forecast[0].forecastFrames = 10;
  candidate.forecast[2].endpointErrorPx.p95 = 201;
  assert.equal(assessFilter(control, candidate, paired).passes, false);
  candidate.forecast[2].endpointErrorPx.p95 = 180;
  candidate.fixed.metrics.wrongPer100 = 5.6;
  assert.equal(assessFilter(control, candidate, paired).passes, false);
  candidate.fixed.metrics.wrongPer100 = 5;
  candidate.fixed.metrics.usefulCoverage = 0.79;
  assert.equal(assessFilter(control, candidate, paired).passes, true);
  candidate.fixed.metrics.usefulCoverage = 0.78;
  assert.equal(assessFilter(control, candidate, paired).passes, false);
});

test('acceptance rejects missing or non-improving primary uncertainty bounds', () => {
  for (const upper95 of [null, NaN, 0, 1]) {
    const comparison = { ...paired, endpoint: [{ horizonMs: 120, upper95 }] };
    assert.equal(assessFilter(report(100), report(90), comparison).passes, false);
  }
});

test('final evaluation refuses source, gate, candidate or motion-seed changes after selection', () => {
  const selection = {
    version: 'test',
    stage: 'development',
    candidate: 'one-filter',
    candidateModule: 'current-production',
    repeats: 12,
    gates: { improvement: 0.05 },
    sourceSha256: { predictor: 'abc', corpus: 'def' },
    traceIds: ['validation/turn/clean/101', 'validation/turn/noisy/101'],
  };

  const final = {
    ...selection,
    stage: 'final',
    traceIds: ['test/turn/clean/202', 'test/turn/noisy/202'],
  };

  assert.doesNotThrow(() => validateSelectionProtocol(final, selection));

  for (const change of [
    { gates: { improvement: 0.01 } },
    { sourceSha256: { predictor: 'changed', corpus: 'def' } },
    { sourceSha256: { predictor: 'abc' } },
    { candidateModule: 'replacement-module' },
    { candidate: 'replacement-filter' },
    { traceIds: ['test/other-family/sparse/101'] },
    { traceIds: [] },
  ]) {
    assert.throws(() => validateSelectionProtocol({ ...final, ...change }, selection));
  }
});
