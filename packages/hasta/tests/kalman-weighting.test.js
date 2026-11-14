import assert from 'node:assert/strict';
import test from 'node:test';

import { KalmanPredictor as PreviousPredictor } from '../benchmarks/stability/baseline-0a503bb/core/prediction/kalman-predictor.js';
import { KalmanPredictor as FrozenPredictor } from '../benchmarks/stability/baseline-fa9ac8d/core/prediction/kalman-predictor.js';
import { KalmanPredictor } from '../dist/core/index.js';
import { KalmanState } from '../dist/core/prediction/kalman-state.js';

function close(actual, expected, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected)),
    `${actual} differs from ${expected}`,
  );
}

function straight(model) {
  for (let timeStamp = 0; timeStamp <= 100; timeStamp++) {
    model.update({ x: timeStamp, y: 0, timeStamp });
  }
}

test('weighted assimilation uses the same effective measurement variance in its mean and covariance', () => {
  const model = new KalmanState({ q: 0, r: 1 });
  model.update({ x: 0, y: 0, timeStamp: 0 });
  model.update({ x: 1, y: -1, timeStamp: 1 });

  const accepted = model.update(
    { x: 1.5, y: -1.5, timeStamp: 2 },
    (residualX, residualY, variance, dt) => {
      assert.equal(residualX, -0.5);
      assert.equal(residualY, 0.5);
      assert.equal(variance, 6);
      assert.equal(dt, 1);

      return 4;
    },
  );

  assert.equal(accepted, true);
  const { state, covariance } = model.diagnostics();
  close(state.x, 31 / 18);
  close(state.y, -31 / 18);
  close(state.vx, 5 / 6);
  close(state.vy, -5 / 6);
  close(covariance[0][0], 20 / 9);
  close(covariance[0][1], 4 / 3);
  close(covariance[1][1], 1);
  assert.equal(covariance[0][1], covariance[1][0]);
});

test('unrepresentable or nonpositive measurement weights restore the previous posterior', () => {
  for (const weight of [Infinity, NaN, 0, -1]) {
    const model = new KalmanState();
    model.update({ x: 0, y: 0, timeStamp: 0 });
    model.update({ x: 1, y: 0, timeStamp: 1 });
    const previous = model.diagnostics();
    assert.equal(
      model.update({ x: 2, y: 1, timeStamp: 2 }, () => weight),
      false,
    );
    assert.deepEqual(model.diagnostics(), previous);
  }
});

test('an isolated pointer spike has limited influence and a genuine turn remains responsive', () => {
  const outlier = new KalmanPredictor();
  straight(outlier);
  outlier.update({ x: 101, y: 24, timeStamp: 101 });
  assert.ok(Math.abs(outlier.predict(101, 120).points[1].y) < 10);

  for (let timeStamp = 102; timeStamp <= 120; timeStamp++) {
    outlier.update({ x: timeStamp, y: 0, timeStamp });
  }

  assert.ok(Math.abs(outlier.predict(120, 120).points[1].y) < 0.02);

  const turning = new KalmanPredictor();
  straight(turning);

  for (let timeStamp = 101; timeStamp <= 132; timeStamp++) {
    turning.update({ x: timeStamp, y: (timeStamp - 100) * 3, timeStamp });
  }

  assert.ok(Math.abs(turning.predict(132, 120).points[1].y - 456) < 1);
});

test('measurements more than 40 ms apart retain linear forecasts even with large innovations', () => {
  const tested = new KalmanPredictor();
  const reference = new FrozenPredictor();
  const rect = { minX: 100, minY: -20, maxX: 120, maxY: 20 };
  let timeStamp = 0;

  for (let index = 0; index < 100; index++) {
    timeStamp += [40.125, 48, 64, 80][index % 4];

    const point = {
      x: 50 * Math.sin(index / 3) + (index % 7 === 0 ? 80 : 0),
      y: 30 * Math.cos(index / 5),
      timeStamp,
    };

    tested.update(point);
    reference.update(point);

    for (const horizon of [16, 120]) {
      assert.deepEqual(
        tested.predict(timeStamp + 1, horizon),
        reference.predict(timeStamp + 1, horizon),
      );
      assert.deepEqual(
        tested.intersectRect(timeStamp + 1, horizon, rect),
        reference.intersectRect(timeStamp + 1, horizon, rect),
      );
    }
  }
});

test('dense samples retain the previous robust forecasts and intersections', () => {
  const tested = new KalmanPredictor();
  const reference = new PreviousPredictor();
  const rect = { minX: 100, minY: -20, maxX: 120, maxY: 20 };
  let timeStamp = 0;

  for (let index = 0; index < 150; index++) {
    timeStamp += [0.125, 1, 4, 8][index % 4];

    const point = {
      x: timeStamp,
      y: 30 * Math.sin(timeStamp / 30) + (index % 17 === 0 ? 40 : 0),
      timeStamp,
    };

    tested.update(point);
    reference.update(point);
    assert.deepEqual(tested.predict(timeStamp, 120), reference.predict(timeStamp, 120));
    assert.deepEqual(
      tested.intersectRect(timeStamp, 120, rect),
      reference.intersectRect(timeStamp, 120, rect),
    );
  }
});

test('isolated sparse spikes have less influence while speed-preserving turns keep ordinary weight', () => {
  for (const dt of [1000 / 120, 12, 1000 / 60]) {
    const tested = new KalmanPredictor();
    const reference = new PreviousPredictor();

    for (let index = 0; index <= 11; index++) {
      const point = { x: index * dt, y: index === 11 ? 24 : 0, timeStamp: index * dt };
      tested.update(point);
      reference.update(point);
    }

    assert.ok(
      Math.abs(tested.predict(11 * dt, 120).points[1].y) <
        Math.abs(reference.predict(11 * dt, 120).points[1].y) / 2,
    );
  }

  const tested = new KalmanPredictor();
  const reference = new FrozenPredictor();

  const positions = [
    [0, 0],
    [10, 0],
    [20, 0],
    [20, 10],
    [20, 20],
    [10, 20],
    [0, 20],
    [0, 10],
  ];

  for (const [index, [x, y]] of positions.entries()) {
    const timeStamp = index * 10;
    tested.update({ x, y, timeStamp });
    reference.update({ x, y, timeStamp });
    assert.deepEqual(tested.predict(timeStamp, 120), reference.predict(timeStamp, 120));
  }
});

test('recent measured speed preserves continuing movement while the filtered speed catches up', () => {
  const tested = new KalmanPredictor();
  const reference = new PreviousPredictor();

  const samples = [
    { x: 140, y: 100, timeStamp: 1000 },
    { x: 146.17251527311362, y: 100, timeStamp: 1006.1725152731136 },
    { x: 154.36676080222242, y: 100, timeStamp: 1014.3667608022224 },
    { x: 160, y: 102.28203350183321, timeStamp: 1022.2820335018332 },
    { x: 160, y: 109.61495264278096, timeStamp: 1029.614952642781 },
    { x: 160, y: 117.39063830629061, timeStamp: 1037.3906383062906 },
    { x: 160, y: 126.11229118464189, timeStamp: 1046.112291184642 },
    { x: 160, y: 114.76331463869451, timeStamp: 1055.0788951204352 },
    { x: 155.46227922663093, y: 100, timeStamp: 1064.537720773369 },
  ];

  for (const sample of samples) {
    tested.update(sample);
    reference.update(sample);
    assert.deepEqual(
      tested.predict(sample.timeStamp, 120),
      reference.predict(sample.timeStamp, 120),
    );
  }
});

test('ordinary innovations retain linear weighting when the innovation to noise ratio overflows', () => {
  for (const r of [Number.MIN_VALUE, 1e-320, 1e-308, 1e-300]) {
    const tested = new KalmanPredictor({}, { r });
    const reference = new FrozenPredictor({}, { r });

    for (const point of [
      { x: 0, y: 0, timeStamp: 0 },
      { x: 16, y: 0, timeStamp: 16 },
      { x: 41, y: 0, timeStamp: 32 },
    ]) {
      tested.update(point);
      reference.update(point);
    }

    assert.deepEqual(tested.predict(32, 120), reference.predict(32, 120));
  }
});

test('same-time sparse corrections restore the recent movement used for plausibility', () => {
  for (const minimumAssimilationDtMs of [0, 12]) {
    const tested = new KalmanPredictor({}, { minimumAssimilationDtMs });
    const reference = new KalmanPredictor({}, { minimumAssimilationDtMs });
    let timeStamp = 0;

    for (let index = 0; index < 60; index++) {
      timeStamp += [9, 16, 33][index % 3];
      const point = { x: timeStamp, y: index % 7 === 0 ? 24 : 0, timeStamp };
      tested.update({ ...point, x: point.x + 100, y: -100 });
      tested.update({ ...point, x: Number.MAX_VALUE, y: Number.MAX_VALUE });
      tested.update(point);
      reference.update(point);
      assert.deepEqual(tested.predict(timeStamp, 120), reference.predict(timeStamp, 120));
    }
  }
});

test('a slow measurement clears pending confirmation before a new dense spike', () => {
  const direct = new KalmanPredictor();
  const corrected = new KalmanPredictor();

  for (const model of [direct, corrected]) {
    straight(model);
    model.update({ x: 101, y: 24, timeStamp: 101 });
  }

  corrected.update({ x: 110, y: 400, timeStamp: 110 });

  for (const model of [direct, corrected]) {
    model.update({ x: 110, y: 24, timeStamp: 110 });
  }

  const previous = direct.predict(111, 120).points[1];

  for (const model of [direct, corrected]) {
    model.update({ x: 111, y: 200, timeStamp: 111 });
  }

  const forecast = direct.predict(111, 120);
  const current = forecast.points[1];
  assert.ok(Math.hypot(current.x - previous.x, current.y - previous.y) < 5);
  assert.deepEqual(corrected.predict(111, 120), forecast);
});

test('same-time corrections restore innovation history before reconsidering a turn', () => {
  for (const minimumAssimilationDtMs of [0, 2]) {
    const corrected = new KalmanPredictor({}, { minimumAssimilationDtMs });
    const direct = new KalmanPredictor({}, { minimumAssimilationDtMs });
    straight(corrected);
    straight(direct);

    for (let timeStamp = 101; timeStamp <= 140; timeStamp++) {
      const point = { x: timeStamp, y: (timeStamp - 100) * 3, timeStamp };
      corrected.update({ ...point, y: point.y - 100 });
      corrected.update({ ...point, x: Number.MAX_VALUE, y: Number.MAX_VALUE });
      corrected.update(point);
      direct.update(point);
      assert.deepEqual(corrected.predict(timeStamp, 120), direct.predict(timeStamp, 120));
    }
  }
});

test('reset and stale gaps clear innovation history', () => {
  for (const explicitReset of [false, true]) {
    const tested = new KalmanPredictor();
    const reference = new KalmanPredictor();
    straight(tested);
    tested.update({ x: 101, y: 100, timeStamp: 101 });

    if (explicitReset) {
      tested.reset();
    }

    const start = explicitReset ? 102 : 201;

    for (let index = 0; index < 20; index++) {
      const point = { x: index, y: index < 4 ? 0 : index * 5, timeStamp: start + index };
      tested.update(point);
      reference.update(point);
      assert.deepEqual(
        tested.predict(point.timeStamp, 120),
        reference.predict(point.timeStamp, 120),
      );
    }
  }
});

test('robust pointer forecasts preserve rotation, translation and physical coordinate scaling', () => {
  const angle = 0.713;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const reference = new KalmanPredictor();

  const transforms = [1e-4, 1, 1e4].map((scale) => ({
    scale,
    model: new KalmanPredictor({}, { q: 0.0016 * scale ** 2, r: 0.25 * scale ** 2 }),
    point: (x, y) => ({
      x: scale * (x * cosine - y * sine + 123),
      y: scale * (x * sine + y * cosine - 456),
    }),
  }));

  let timeStamp = 0;

  for (let index = 0; index < 250; index++) {
    timeStamp += [0.125, 1, 4, 12][index % 4];
    const spike = index % 19 === 0 ? 40 : 0;
    const point = { x: timeStamp, y: 20 * Math.sin(timeStamp / 20) + spike, timeStamp };
    reference.update(point);
    const forecast = reference.predict(timeStamp + 0.125, 120);

    for (const transform of transforms) {
      transform.model.update({ ...transform.point(point.x, point.y), timeStamp });
      const transformed = transform.model.predict(timeStamp + 0.125, 120);

      if (forecast === null) {
        assert.equal(transformed, null);
        continue;
      }

      for (let endpoint = 0; endpoint < 2; endpoint++) {
        const expected = transform.point(forecast.points[endpoint].x, forecast.points[endpoint].y);
        close(transformed.points[endpoint].x / transform.scale, expected.x / transform.scale);
        close(transformed.points[endpoint].y / transform.scale, expected.y / transform.scale);
      }
    }
  }
});
