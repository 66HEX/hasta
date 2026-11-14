import assert from 'node:assert/strict';
import test from 'node:test';

import { KalmanPredictor as Reference } from '../benchmarks/stability/baseline-d514639/core/prediction/kalman-predictor.js';
import { loadFilterControl } from '../benchmarks/stability/filter-controls.mjs';
import { KalmanPredictor } from '../dist/core/index.js';

const horizons = [16, 60, 120, 160];

const rects = [
  { minX: -20, maxX: 20, minY: -20, maxY: 20 },
  { minX: 100, maxX: 120, minY: -100, maxY: 100 },
];

function equivalent(actual, expected, now) {
  for (const age of [0, 4, 99, 100]) {
    for (const horizon of horizons) {
      assert.deepEqual(actual.predict(now + age, horizon), expected.predict(now + age, horizon));

      for (const rect of rects) {
        assert.deepEqual(
          actual.intersectRect(now + age, horizon, rect),
          expected.intersectRect(now + age, horizon, rect),
        );
      }
    }
  }
}

function updateWithCorrections(model, sample, i) {
  if (i % 71 === 0) {
    model.reset();
  }

  model.update(sample);

  if (i % 7 === 0) {
    model.update({ ...sample, x: sample.x + 40, y: sample.y - 40 });
    model.update({ ...sample, x: Number.MAX_VALUE });
    model.update(sample);
  }

  model.update({ ...sample, timeStamp: sample.timeStamp - 1, x: -100 });
  model.update({ ...sample, x: NaN });
}

test('CPU control preserves the committed adaptive predictor and historical defaults', async () => {
  const control = await loadFilterControl('d514639');
  assert.equal(control.commit, 'd5146391a816121c2296ec9a3dcc85caaf70032b');
  assert.equal((await loadFilterControl()).name, 'fa9ac8d');
});

test('buffer reuse preserves exact forecasts after corrections, failures, decimation and resets', () => {
  for (const noise of [{}, { q: 0, r: 1e-12 }, { q: 0.01, r: 4 }]) {
    for (const minimumAssimilationDtMs of [0, 2, 9]) {
      for (const positionAnchor of ['filtered', 'measured']) {
        const config = { ...noise, minimumAssimilationDtMs, positionAnchor };
        const actual = new KalmanPredictor({}, config);
        const expected = new Reference({}, config);
        let timeStamp = 0;

        for (let i = 0; i < 240; i++) {
          timeStamp += [0.125, 1, 4, 8, 1000 / 120, 16, 33, 40, 40.125, 99, 100][i % 11];

          const sample = {
            timeStamp,
            x: timeStamp * 0.2 + Math.sin(i) * 0.5,
            y: Math.sin(i / 13) * 40 + (i % 29 === 0 ? 24 : 0),
          };

          for (const model of [actual, expected]) {
            updateWithCorrections(model, sample, i);
          }

          equivalent(actual, expected, timeStamp);
        }
      }
    }
  }
});

test('shared residuals preserve subnormal, overflowing and threshold-adjacent estimates', () => {
  for (const scale of [Number.MIN_VALUE, 1e-160, 1e-4, 1, 1e4, 1e150]) {
    const config = {
      q: Math.max(Number.MIN_VALUE, 0.0016 * scale * scale),
      r: Math.max(Number.MIN_VALUE, 0.25 * scale * scale),
    };

    const actual = new KalmanPredictor({}, config);
    const expected = new Reference({}, config);

    for (let i = 0; i < 200; i++) {
      const sample = { timeStamp: i * 8, x: i * scale, y: [0, 0.5, 1.25, 3, -3, 0][i % 6] * scale };

      actual.update(sample);
      expected.update(sample);
      equivalent(actual, expected, sample.timeStamp);
    }
  }
});

test('projection reuse preserves signed zero, query order and sample invalidation', () => {
  for (const config of [{}, { positionAnchor: 'measured', minimumAssimilationDtMs: 9 }]) {
    const actual = new KalmanPredictor({}, config);
    const expected = new Reference({}, config);

    for (const sample of [
      { x: -0, y: -0, timeStamp: -10 },
      { x: -0, y: -0, timeStamp: 0 },
      { x: 4, y: 2, timeStamp: 8 },
      { x: 10, y: 3, timeStamp: 16 },
      { x: 12, y: 4, timeStamp: 16 },
      { x: Number.MAX_VALUE, y: 4, timeStamp: 24 },
      { x: 14, y: 4, timeStamp: 24 },
    ]) {
      actual.update(sample);
      expected.update(sample);

      for (const now of [sample.timeStamp, -0, +0, sample.timeStamp + 4, sample.timeStamp]) {
        equivalent(actual, expected, now);
        equivalent(actual, expected, now);
      }
    }

    actual.reset();
    expected.reset();
    equivalent(actual, expected, 24);
  }
});

test('projection reuse preserves invalid query errors before and after warming the cache', () => {
  const model = new KalmanPredictor();

  for (const warmed of [false, true]) {
    if (warmed) {
      model.update({ x: 0, y: 0, timeStamp: -8 });
      model.update({ x: 1, y: 1, timeStamp: 0 });
      model.predict(0, 120);
    }

    for (const [now, horizon] of [
      [NaN, undefined],
      [undefined, undefined],
      [NaN, 120],
      [Infinity, 120],
      [0, 0],
      [0, NaN],
      [0, undefined],
      [0, Infinity],
    ]) {
      assert.throws(() => model.predict(now, horizon), RangeError);
      assert.throws(() => model.intersectRect(now, horizon, rects[0]), RangeError);
    }
  }
});
