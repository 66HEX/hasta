import assert from 'node:assert/strict';
import test from 'node:test';

import { createModel } from '../benchmarks/comparison/models.mjs';
import { Random } from '../benchmarks/comparison/random.mjs';

const configs = [
  { kind: 'cv' },
  { kind: 'regression', windowMs: 16 },
  { kind: 'kalman', q: 1e-4, r: 0.25 },
  { kind: 'particle', q: 1e-4, r: 0.25, particles: 128 },
  { kind: 'particle', q: 1e-4, r: 0.25, particles: 128, observation: 'student-t' },
];

function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

test('all comparison models preserve the production warmup, expiry and reset contract', () => {
  for (const config of configs) {
    const model = createModel({ ...config, maxSampleAgeMs: 40 });
    assert.equal(model.predict(0, 10), null);
    model.update({ x: 0, y: 0, timeStamp: 0 });
    model.update({ x: 1, y: 2, timeStamp: 0 });
    assert.equal(model.predict(0, 10), null);
    model.update({ x: 10, y: 20, timeStamp: 10 });
    assert.equal(model.predict(9, 10), null);
    assert.notEqual(model.predict(49, 10), null);
    assert.equal(model.predict(50, 10), null);
    model.update({ x: 50, y: 100, timeStamp: 50 });
    assert.equal(model.predict(50, 10), null);
    model.update({ x: 60, y: 120, timeStamp: 60 });
    assert.notEqual(model.predict(60, 10), null);
    model.reset();
    model.reset();
    assert.equal(model.predict(60, 10), null);
  }
});

test('same-time replacements match a stream containing only the accepted coordinates', () => {
  for (const config of configs) {
    const replaced = createModel(config, 174);
    const direct = createModel(config, 174);

    for (let time = 0; time < 24; time++) {
      const sample = { x: 0.5 * time, y: 0.2 * time, timeStamp: time };
      replaced.update({ x: 1000, y: -1000, timeStamp: time });
      replaced.update(sample);
      direct.update(sample);
      assert.deepEqual(
        replaced.predict(time, 30),
        direct.predict(time, 30),
        JSON.stringify(config),
      );
      assert.deepEqual(replaced.getDiagnostics?.(), direct.getDiagnostics?.());
    }
  }
});

test('older and non-finite observations leave the next prediction and random state unchanged', () => {
  for (const config of configs) {
    const tested = createModel(config, 91);
    const reference = createModel(config, 91);

    for (let time = 0; time < 20; time++) {
      const sample = { x: time, y: -time / 2, timeStamp: time };
      tested.update(sample);
      reference.update(sample);
      tested.update({ x: 10000, y: 10000, timeStamp: time - 1 });
      tested.update({ x: NaN, y: 0, timeStamp: time + 1 });
      tested.update({ x: 0, y: Infinity, timeStamp: time + 1 });
      tested.update({ x: 0, y: 0, timeStamp: Infinity });
    }

    assert.deepEqual(tested.predict(20, 60), reference.predict(20, 60));
  }
});

test('forecast requests do not mutate filters and return deeply immutable snapshots', () => {
  for (const config of configs) {
    const model = createModel(config);

    for (let time = 0; time < 30; time++) {
      const sample = { x: time, y: time / 2, timeStamp: time };
      model.update(sample);
      sample.x = 100000;
    }

    const first = model.predict(30, 60);
    const diagnostic = model.getDiagnostics?.();
    model.predict(50, 300);
    model.predict(29, 1);
    assert.deepEqual(model.predict(30, 60), first);
    assert.deepEqual(model.getDiagnostics?.(), diagnostic);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Object.isFrozen(first.points), true);
    assert.ok(first.points.every((point) => Object.isFrozen(point)));
  }
});

test('the Kalman update matches an analytical two-observation posterior', () => {
  const model = createModel({ kind: 'kalman', q: 0, r: 1, initialVelocityStd: 2 });
  model.update({ x: 0, y: 0, timeStamp: 0 });
  model.update({ x: 1, y: -1, timeStamp: 1 });
  const { state, covariance } = model.getDiagnostics();
  near(state.x, 5 / 6);
  near(state.y, -5 / 6);
  near(state.vx, 2 / 3);
  near(state.vy, -2 / 3);
  near(covariance[0][0], 5 / 6);
  near(covariance[0][1], 2 / 3);
  near(covariance[1][0], 2 / 3);
  near(covariance[1][1], 4 / 3);
});

test('Kalman process noise follows the continuous acceleration model at non-unit dt', () => {
  const model = createModel({ kind: 'kalman', q: 0.3, r: 0.7, initialVelocityStd: 2 });
  model.update({ x: 0, y: 0, timeStamp: 0 });
  model.update({ x: 1, y: -1, timeStamp: 2 });
  const { state, covariance } = model.getDiagnostics();
  near(state.x, 175 / 182);
  near(state.y, -175 / 182);
  near(state.vx, 43 / 91);
  near(state.vy, -43 / 91);
  near(covariance[0][0], 245 / 364);
  near(covariance[0][1], 301 / 910);
  near(covariance[1][1], 244 / 455);
});

test('Kalman covariance stays finite, symmetric and positive semidefinite across irregular updates', () => {
  const random = new Random(1297);

  for (const q of [0, 1e-6, 0.01, 0.1]) {
    const model = createModel({ kind: 'kalman', q, r: 0.01 });
    let time = 0;

    for (let index = 0; index < 2000; index++) {
      time += 0.125 + random.uniform() * 30;
      model.update({ x: Math.sin(time / 100) * 200, y: random.normal(), timeStamp: time });
      const { covariance } = model.getDiagnostics();
      const [[pp, pv], [vp, vv]] = covariance;
      assert.ok(covariance.flat().every((value) => Number.isFinite(value)));
      assert.equal(pv, vp);
      assert.ok(pp >= 0 && vv >= 0);
      assert.ok(pp * vv - pv * pv >= -1e-12);
    }
  }
});

test('regression reconstructs constant velocity at irregular sample intervals', () => {
  const model = createModel({ kind: 'regression', windowMs: 16 });
  const random = new Random(271);
  let time = 0;

  for (let index = 0; index < 200; index++) {
    time += 0.125 + random.uniform() * 4;
    model.update({ x: 100 + 0.75 * time, y: 30 - time / 2, timeStamp: time });
  }

  const endpoint = model.predict(time + 3, 60).points[1];
  near(endpoint.x, 100 + 0.75 * (time + 63), 1e-9);
  near(endpoint.y, 30 - (time + 63) / 2, 1e-9);
});

test('the Kalman state converges on constant velocity and suppresses stationary measurement noise', () => {
  const moving = createModel({ kind: 'kalman', q: 1e-4, r: 0.25 });
  const stationary = createModel({ kind: 'kalman', q: 1e-6, r: 0.25 });
  const random = new Random(371);
  let inputSquaredError = 0;
  let filteredSquaredError = 0;

  for (let time = 0; time < 2000; time++) {
    moving.update({ x: time, y: -time / 2, timeStamp: time });
    const x = 50 + random.normal() / 2;
    const y = 100 + random.normal() / 2;
    stationary.update({ x, y, timeStamp: time });

    if (time > 100) {
      const state = stationary.getDiagnostics().state;
      inputSquaredError += (x - 50) ** 2 + (y - 100) ** 2;
      filteredSquaredError += (state.x - 50) ** 2 + (state.y - 100) ** 2;
    }
  }

  const endpoint = moving.predict(1999, 60).points[1];
  near(endpoint.x, 2059, 1e-5);
  near(endpoint.y, -2059 / 2, 1e-5);
  assert.ok(filteredSquaredError < inputSquaredError / 4);
});

test('particle weights remain normalized when ordinary likelihoods would underflow', () => {
  for (const observation of ['gaussian', 'student-t']) {
    const model = createModel({ kind: 'particle', observation, q: 0.01, r: 0.25, particles: 256 });

    for (let time = 0; time < 100; time++) {
      const x = time === 50 ? 10000 : time / 2;
      model.update({ x, y: 0, timeStamp: time });
      const state = model.getDiagnostics();
      near(state.weightSum, 1, 1e-12);
      assert.ok(state.ess >= 1 - 1e-10 && state.ess <= 256 + 1e-10);
      assert.ok(Object.values(state.state).every((value) => Number.isFinite(value)));
    }

    assert.ok(model.getDiagnostics().resamples > 0);
  }
});

test('particle seeds reproduce a run and reset restores the initial random stream', () => {
  const model = createModel({ kind: 'particle', particles: 128 }, 171);
  const other = createModel({ kind: 'particle', particles: 128 }, 172);

  const run = (value) => {
    for (let time = 0; time < 50; time++) {
      value.update({ x: time, y: time / 4, timeStamp: time });
    }

    return value.predict(50, 60);
  };

  const first = run(model);
  assert.notDeepEqual(run(other), first);
  model.reset();
  assert.deepEqual(run(model), first);
});

test('unrepresentable intermediate arithmetic does not poison later ordinary measurements', () => {
  for (const config of configs) {
    const model = createModel(config);
    model.update({ x: 0, y: 0, timeStamp: 0 });
    model.update({ x: 1, y: 0, timeStamp: 1 });
    model.update({ x: Number.MAX_VALUE, y: 0, timeStamp: 2 });

    for (let time = 3; time <= 100; time++) {
      model.update({ x: time, y: 0, timeStamp: time });
    }

    const endpoint = model.predict(100, 10).points[1];
    assert.ok(Number.isFinite(endpoint.x) && Number.isFinite(endpoint.y));
    assert.ok(Math.hypot(endpoint.x - 110, endpoint.y) < 10);
  }
});

test('many Gaussian particles approximate the matched Kalman posterior across independent seeds', () => {
  const q = 0.01;
  const r = 1;
  const random = new Random(1943);
  const observations = [];
  let x = 0;
  let y = 0;
  let vx = 0.5;
  let vy = -0.25;

  for (let time = 0; time < 40; time++) {
    const dvx = Math.sqrt(q) * random.normal();
    const dvy = Math.sqrt(q) * random.normal();
    x += vx + dvx / 2 + Math.sqrt(q / 12) * random.normal();
    y += vy + dvy / 2 + Math.sqrt(q / 12) * random.normal();
    vx += dvx;
    vy += dvy;
    observations.push({ x: x + random.normal(), y: y + random.normal(), timeStamp: time });
  }

  const reference = createModel({ kind: 'kalman', q, r });
  observations.forEach((sample) => reference.update(sample));
  const expected = reference.getDiagnostics().state;
  let positionError = 0;
  let velocityError = 0;

  for (const seed of [181, 913, 3711, 7422]) {
    const model = createModel({ kind: 'particle', q, r, particles: 8192 }, seed);
    observations.forEach((sample) => model.update(sample));
    const actual = model.getDiagnostics().state;
    positionError += Math.hypot(actual.x - expected.x, actual.y - expected.y);
    velocityError += Math.hypot(actual.vx - expected.vx, actual.vy - expected.vy);
  }

  assert.ok(positionError / 4 < 0.2, `Mean position discrepancy: ${positionError / 4}`);
  assert.ok(velocityError / 4 < 0.05, `Mean velocity discrepancy: ${velocityError / 4}`);
});

test('model configuration and prediction times reject invalid values', () => {
  for (const config of configs) {
    assert.throws(() => createModel({ ...config, maxSampleAgeMs: 0 }), RangeError);
    const model = createModel(config);
    assert.throws(() => model.predict(NaN, 60), RangeError);
    assert.throws(() => model.predict(0, 0), RangeError);
  }

  assert.throws(() => createModel({ kind: 'kalman', q: -1 }), RangeError);
  assert.throws(() => createModel({ kind: 'kalman', r: 0 }), RangeError);
  assert.throws(() => createModel({ kind: 'particle', particles: 1 }), RangeError);
  assert.throws(() => createModel({ kind: 'particle', observation: 'unknown' }), TypeError);
  assert.throws(() => createModel({ kind: 'regression', windowMs: Infinity }), RangeError);
  assert.throws(() => createModel({ kind: 'unknown' }), TypeError);
});
