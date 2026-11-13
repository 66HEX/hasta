import assert from 'node:assert/strict';
import test from 'node:test';

import { KalmanPredictor } from '../dist/core/prediction/kalman-predictor.js';

test('propagates the last measurement to evaluation time before applying the horizon', () => {
  const predictor = new KalmanPredictor();
  predictor.update({ x: 0, y: 40, timeStamp: 10 });
  predictor.update({ x: 20, y: 30, timeStamp: 20 });
  assert.deepEqual(predictor.predict(25, 50), {
    generatedAt: 25,
    points: [
      { x: 30, y: 25, offsetMs: 0 },
      { x: 130, y: -25, offsetMs: 50 },
    ],
  });
});

test('requires distinct timestamps and rejects stale or not-yet-observed states', () => {
  const predictor = new KalmanPredictor({ maxSampleAgeMs: 50 });
  assert.equal(predictor.predict(0, 10), null);
  predictor.update({ x: 0, y: 0, timeStamp: 10 });
  predictor.update({ x: 10, y: 0, timeStamp: 10 });
  assert.equal(predictor.predict(10, 10), null);
  predictor.update({ x: 20, y: 0, timeStamp: 20 });
  assert.equal(predictor.predict(19, 10), null);
  assert.notEqual(predictor.predict(69, 10), null);
  assert.equal(predictor.predict(70, 10), null);
});

test('replaces equal-time coordinates and ignores older or invalid measurements', () => {
  const predictor = new KalmanPredictor();
  predictor.update({ x: 0, y: 0, timeStamp: 10 });
  predictor.update({ x: 10, y: 0, timeStamp: 20 });
  predictor.update({ x: 20, y: 10, timeStamp: 20 });
  predictor.update({ x: 400, y: 400, timeStamp: 19 });
  predictor.update({ x: NaN, y: 0, timeStamp: 21 });
  predictor.update({ x: 0, y: Infinity, timeStamp: 22 });
  predictor.update({ x: 0, y: 0, timeStamp: Infinity });
  assert.deepEqual(predictor.predict(20, 10)?.points, [
    { x: 20, y: 10, offsetMs: 0 },
    { x: 40, y: 20, offsetMs: 10 },
  ]);
});

test('a long sample gap and an explicit reset require fresh warmup', () => {
  const predictor = new KalmanPredictor({ maxSampleAgeMs: 40 });
  predictor.update({ x: 0, y: 0, timeStamp: 0 });
  predictor.update({ x: 10, y: 0, timeStamp: 10 });
  predictor.update({ x: 400, y: 0, timeStamp: 50 });
  assert.equal(predictor.predict(50, 10), null);
  predictor.update({ x: 420, y: 0, timeStamp: 60 });
  assert.equal(predictor.predict(60, 10)?.points[1]?.x, 440);
  predictor.reset();
  predictor.reset();
  assert.equal(predictor.predict(60, 10), null);
  predictor.update({ x: 430, y: 0, timeStamp: 70 });
  assert.equal(predictor.predict(70, 10), null);
});

test('stationary measurements produce a stationary forecast', () => {
  const predictor = new KalmanPredictor();
  predictor.update({ x: -5.5, y: 3.25, timeStamp: 0 });
  predictor.update({ x: -5.5, y: 3.25, timeStamp: 10 });
  assert.deepEqual(predictor.predict(20, 120)?.points, [
    { x: -5.5, y: 3.25, offsetMs: 0 },
    { x: -5.5, y: 3.25, offsetMs: 120 },
  ]);
});

test('snapshots observations and returns deeply immutable predictions', () => {
  const predictor = new KalmanPredictor();
  const sample = { x: 1, y: 2, timeStamp: 0 };
  predictor.update(sample);
  sample.x = 1000;
  predictor.update({ x: 11, y: 12, timeStamp: 10 });
  const prediction = predictor.predict(10, 10);
  assert.equal(prediction?.points[1]?.x, 21);
  assert.equal(Object.isFrozen(prediction), true);
  assert.equal(Object.isFrozen(prediction.points), true);
  assert.equal(Object.isFrozen(prediction.points[0]), true);
  assert.throws(() => {
    prediction.points[0].x = 100;
  }, TypeError);
});

test('refuses forecasts when coordinate differences or extrapolation overflow', () => {
  const predictor = new KalmanPredictor();
  predictor.update({ x: -Number.MAX_VALUE, y: 0, timeStamp: 0 });
  predictor.update({ x: Number.MAX_VALUE, y: 0, timeStamp: 10 });
  assert.equal(predictor.predict(10, 10), null);
  predictor.reset();
  predictor.update({ x: 0, y: 0, timeStamp: 0 });
  predictor.update({ x: Number.MAX_VALUE / 2, y: 0, timeStamp: 1 });
  assert.equal(predictor.predict(1, 10), null);
});

test('validates configuration and prediction arguments', () => {
  for (const maxSampleAgeMs of [0, -1, NaN, Infinity]) {
    assert.throws(() => new KalmanPredictor({ maxSampleAgeMs }), RangeError);
  }

  const predictor = new KalmanPredictor();

  for (const horizonMs of [0, -1, NaN, Infinity]) {
    assert.throws(() => predictor.predict(0, horizonMs), RangeError);
  }

  assert.throws(() => predictor.predict(NaN, 10), RangeError);
  assert.throws(() => predictor.predict(Infinity, 10), RangeError);
});

test('recovers after unrepresentable velocity without poisoning later ordinary samples', () => {
  const predictor = new KalmanPredictor();
  predictor.update({ x: 0, y: 0, timeStamp: 0 });
  predictor.update({ x: 1, y: 1, timeStamp: Number.MIN_VALUE });
  assert.equal(predictor.predict(Number.MIN_VALUE, 10), null);
  predictor.update({ x: 2, y: 3, timeStamp: 1 });
  assert.deepEqual(predictor.predict(1, 1)?.points, [
    { x: 2, y: 3, offsetMs: 0 },
    { x: 3, y: 5, offsetMs: 1 },
  ]);
});

test('a velocity below the subnormal range still accumulates representable displacement', () => {
  const unit = Number.MIN_VALUE;
  const predictor = new KalmanPredictor();
  predictor.update({ x: 0, y: 0, timeStamp: 0 });
  predictor.update({ x: unit, y: 2 * unit, timeStamp: 2 });
  assert.deepEqual(predictor.predict(12, 120)?.points, [
    { x: 6 * unit, y: 12 * unit, offsetMs: 0 },
    { x: 66 * unit, y: 132 * unit, offsetMs: 120 },
  ]);
  assert.deepEqual(
    predictor.intersectRect(12, 120, {
      minX: 0,
      maxX: 100 * unit,
      minY: 20 * unit,
      maxY: 40 * unit,
    }),
    { offsetMs: 8, point: { x: 10 * unit, y: 20 * unit } },
  );
});

test('partially rounded subnormal velocities preserve displacement and intersection points', () => {
  const unit = Number.MIN_VALUE;
  const predictor = new KalmanPredictor();
  predictor.update({ x: 0, y: 0, timeStamp: 0 });
  predictor.update({ x: unit, y: 3 * unit, timeStamp: 1.5 });
  assert.deepEqual(predictor.predict(1.5, 3)?.points, [
    { x: unit, y: 3 * unit, offsetMs: 0 },
    { x: 3 * unit, y: 9 * unit, offsetMs: 3 },
  ]);
  assert.deepEqual(
    predictor.intersectRect(1.5, 3, {
      minX: 0,
      maxX: 100 * unit,
      minY: 9 * unit,
      maxY: 10 * unit,
    }),
    { offsetMs: 3, point: { x: 3 * unit, y: 9 * unit } },
  );
  assert.ok(Number.isFinite(predictor.predict(1.5, Number.MAX_VALUE)?.points[1].x));
});

test('reconstructs analytic constant-velocity tracks for 1000 seeded sampling schedules', () => {
  let seed = 0x12345678;

  const integer = (size) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed % size;
  };

  for (let run = 0; run < 1000; run++) {
    const predictor = new KalmanPredictor();
    const x = integer(1000) - 500;
    const y = integer(1000) - 500;
    const vx = (integer(81) - 40) / 4;
    const vy = (integer(81) - 40) / 4;
    let time = integer(10000);

    for (let step = 0; step < 4; step++) {
      time += 1 + integer(20);
      predictor.update({ x: x + vx * time, y: y + vy * time, timeStamp: time });
    }

    const now = time + integer(100);
    const horizon = 1 + integer(300);
    assert.deepEqual(predictor.predict(now, horizon), {
      generatedAt: now,
      points: [
        { x: x + vx * now, y: y + vy * now, offsetMs: 0 },
        { x: x + vx * (now + horizon), y: y + vy * (now + horizon), offsetMs: horizon },
      ],
    });
  }
});
