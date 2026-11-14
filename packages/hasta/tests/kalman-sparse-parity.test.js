import assert from 'node:assert/strict';
import test from 'node:test';

import { KalmanPredictor as ReferencePredictor } from '../benchmarks/stability/baseline-5cf01cf/core/prediction/kalman-predictor.js';
import { KalmanPredictor } from '../dist/core/index.js';

function adjacentPositive(value, direction) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + BigInt(direction));

  return view.getFloat64(0);
}

function forecast(Model, dt, currentX) {
  const model = new Model({}, { q: 0, r: 1e-12 });
  model.update({ x: 0, y: 0, timeStamp: 0 });
  model.update({ x: dt, y: 0, timeStamp: dt });
  model.update({ x: currentX, y: 0, timeStamp: 2 * dt });

  return model.predict(2 * dt, 120);
}

test('adjacent floating values at the sparse speed threshold retain their original weights', () => {
  for (const dt of [adjacentPositive(8, 1), 1000 / 120, 12, 1000 / 60, 33, 40]) {
    const thresholdX = 2.5 * dt;
    let lower = thresholdX;
    let upper = thresholdX;

    for (let step = 0; step < 5; step++) {
      for (const x of [lower, thresholdX, upper]) {
        assert.deepEqual(forecast(KalmanPredictor, dt, x), forecast(ReferencePredictor, dt, x));
      }

      lower = adjacentPositive(lower, -1);
      upper = adjacentPositive(upper, 1);
    }

    // Tiny measurement noise makes a wrongly bypassed innovation observable
    assert.ok(
      Math.abs(
        forecast(ReferencePredictor, dt, lower).points[1].x -
          forecast(ReferencePredictor, dt, upper).points[1].x,
      ) > 1,
    );
  }
});

test('sparse comparisons retain exact forecasts for subnormal and overflowing squared norms', () => {
  for (const scale of [1e-170, 1e-160, 1e-150, 1, 1e150, 1e160]) {
    const r = scale < 1 ? Math.max(Number.MIN_VALUE, 1e-12 * scale * scale) : 1e-12;
    const tested = new KalmanPredictor({}, { q: 0, r });
    const reference = new ReferencePredictor({}, { q: 0, r });

    for (const [index, [x, y]] of [
      [0, 0],
      [16, 8],
      [40, 20],
      [64, 32],
      [60, 48],
      [-16, -8],
    ].entries()) {
      const point = { x: x * scale, y: y * scale, timeStamp: index * 16 };
      tested.update(point);
      reference.update(point);
      assert.deepEqual(
        tested.predict(point.timeStamp, 120),
        reference.predict(point.timeStamp, 120),
      );
    }
  }
});

test('mixed sparse corrections preserve forecasts and intersections across assimilation configurations', () => {
  const intervals = [1, 8, 1000 / 120, 9, 1000 / 60, 33, 40, 40.125];
  const rect = { minX: 100, maxX: 140, minY: -20, maxY: 20 };

  for (const minimumAssimilationDtMs of [0, 2, 9]) {
    for (const positionAnchor of ['filtered', 'measured']) {
      const config = { minimumAssimilationDtMs, positionAnchor };
      const tested = new KalmanPredictor({}, config);
      const reference = new ReferencePredictor({}, config);
      let timeStamp = 0;

      for (let index = 0; index < 160; index++) {
        timeStamp += intervals[index % intervals.length];

        const point = {
          x: timeStamp + (index % 13 === 0 ? 24 : 0),
          y: 30 * Math.sin(timeStamp / 30),
          timeStamp,
        };

        tested.update({ ...point, x: point.x + 100, y: -100 });
        tested.update({ ...point, x: Number.MAX_VALUE, y: Number.MAX_VALUE });
        tested.update(point);
        reference.update(point);
        assert.deepEqual(tested.predict(timeStamp + 1, 120), reference.predict(timeStamp + 1, 120));
        assert.deepEqual(
          tested.intersectRect(timeStamp + 1, 120, rect),
          reference.intersectRect(timeStamp + 1, 120, rect),
        );
      }
    }
  }
});
