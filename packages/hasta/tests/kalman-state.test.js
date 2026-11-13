import assert from 'node:assert/strict';
import test from 'node:test';

import { KalmanState } from '../dist/core/prediction/kalman-state.js';

function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
}

function sample(timeStamp, x, y = -x / 2) {
  return { timeStamp, x, y };
}

function accepted(model, observation) {
  assert.equal(model.update(observation), true);
}

test('two distinct measurements initialize the secant mean and correlated uncertainty', () => {
  for (const dt of [0.125, 1, 2, 20]) {
    const model = new KalmanState({ q: 0.3, r: 1 });
    assert.equal(model.state(), null);
    accepted(model, sample(100, 50, -20));
    assert.equal(model.state(), null);
    accepted(model, sample(100 + dt, 50 + 0.75 * dt, -20 - dt / 2));
    assert.deepEqual(model.state(), {
      x: 50 + 0.75 * dt,
      y: -20 - dt / 2,
      vx: 0.75,
      vy: -0.5,
    });
    const [[pp, pv], [vp, vv]] = model.diagnostics().covariance;
    near(pp, 1);
    near(pv, 1 / dt);
    assert.equal(pv, vp);
    near(vv, 2 / dt ** 2 + (0.3 * dt) / 3);
  }
});

test('the third measurement matches an analytical zero-process-noise posterior', () => {
  const model = new KalmanState({ q: 0, r: 1 });
  accepted(model, sample(0, 0, 0));
  accepted(model, sample(1, 1, -1));
  accepted(model, sample(2, 1.5, -1.5));
  const result = model.diagnostics();
  near(result.state.x, 19 / 12);
  near(result.state.y, -19 / 12);
  near(result.state.vx, 0.75);
  near(result.state.vy, -0.75);
  near(result.covariance[0][0], 5 / 6);
  near(result.covariance[0][1], 0.5);
  near(result.covariance[1][1], 0.5);
});

test('continuous acceleration covariance follows dt cubed, squared and linear scaling', () => {
  const model = new KalmanState({ q: 0.3, r: 1 });
  accepted(model, sample(0, 0, 0));
  accepted(model, sample(2, 2, -2));
  accepted(model, sample(5, 5.5, -5.5));
  const result = model.diagnostics();

  // Independent Gaussian reference: predicted covariance is [13, 3.95, 1.6], R = 1
  near(result.state.x, 5 + (0.5 * 13) / 14);
  near(result.state.y, -5 - (0.5 * 13) / 14);
  near(result.state.vx, 1 + (0.5 * 3.95) / 14);
  near(result.state.vy, -1 - (0.5 * 3.95) / 14);
  near(result.covariance[0][0], 13 / 14);
  near(result.covariance[0][1], 3.95 / 14);
  near(result.covariance[1][1], 1.6 - 3.95 ** 2 / 14);
});

test('without process noise sequential estimation matches a batch least-squares posterior', () => {
  const r = 0.7;
  const model = new KalmanState({ q: 0, r });
  const times = [0, 0.125, 1.5, 3, 8, 13, 14, 20, 31, 32.5];

  const observations = times.map((time) =>
    sample(time, 2 + 0.7 * time + Math.sin(time), -4 + 0.2 * time + Math.cos(time * 2)),
  );

  for (const observation of observations) {
    accepted(model, observation);
  }

  const lastTime = times.at(-1);
  const shiftedTimes = times.map((time) => time - lastTime);
  const meanTime = shiftedTimes.reduce((sum, value) => sum + value, 0) / times.length;
  const centeredTimeSquares = shiftedTimes.reduce((sum, time) => sum + (time - meanTime) ** 2, 0);

  for (const [coordinate, velocity] of [
    ['x', 'vx'],
    ['y', 'vy'],
  ]) {
    const meanPosition =
      observations.reduce((sum, point) => sum + point[coordinate], 0) / times.length;

    const slope =
      observations.reduce(
        (sum, point, index) =>
          sum + (shiftedTimes[index] - meanTime) * (point[coordinate] - meanPosition),
        0,
      ) / centeredTimeSquares;

    near(model.state()[coordinate], meanPosition - slope * meanTime);
    near(model.state()[velocity], slope);
  }

  const covariance = model.diagnostics().covariance;
  near(covariance[0][0], r / times.length + (r * meanTime ** 2) / centeredTimeSquares);
  near(covariance[0][1], (-r * meanTime) / centeredTimeSquares);
  near(covariance[1][1], r / centeredTimeSquares);
});

test('same-time replacement restores both the mean and covariance before assimilation', () => {
  const replaced = new KalmanState();
  const direct = new KalmanState();

  for (let index = 0; index < 150; index++) {
    const time = index / 8;
    const observation = sample(time, Math.sin(time / 3), Math.cos(time / 5));
    accepted(replaced, sample(time, 10000, -10000));
    accepted(replaced, observation);
    accepted(replaced, observation);
    accepted(direct, observation);
    assert.deepEqual(replaced.diagnostics(), direct.diagnostics());
  }
});

test('scaling process and measurement variance preserves the mean and scales covariance', () => {
  const q = 0.003;
  const r = 0.7;
  const reference = new KalmanState({ q, r });

  const models = [1e-12, 1e-6, 1e6, 1e12].map((scale) => ({
    scale,
    model: new KalmanState({ q: q * scale, r: r * scale }),
  }));

  let time = 0;

  for (let index = 0; index < 100; index++) {
    time += 0.125 + (index % 7);
    const observation = sample(time, 20 * Math.sin(time / 10), 15 * Math.cos(time / 17));
    accepted(reference, observation);
    const expected = reference.diagnostics();

    for (const { scale, model } of models) {
      accepted(model, observation);
      const actual = model.diagnostics();

      if (expected.state !== null) {
        for (const key of ['x', 'y', 'vx', 'vy']) {
          near(actual.state[key], expected.state[key]);
        }
      }

      near(actual.covariance[0][0] / scale, expected.covariance[0][0]);
      near(actual.covariance[0][1] / scale, expected.covariance[0][1]);
      near(actual.covariance[1][1] / scale, expected.covariance[1][1]);
    }
  }
});

test('invalid and older measurements leave the next posterior unchanged', () => {
  const tested = new KalmanState();
  const reference = new KalmanState();

  for (let time = 0; time < 50; time++) {
    const observation = sample(time, Math.sin(time / 10));
    accepted(tested, observation);
    accepted(reference, observation);
    accepted(tested, sample(time - 1, 1000));
    accepted(tested, sample(time + 1, NaN));
    accepted(tested, sample(time + 1, 0, Infinity));
    accepted(tested, sample(Infinity, 0));
  }

  assert.deepEqual(tested.diagnostics(), reference.diagnostics());
});

test('reset clears covariance and requires two new timestamps', () => {
  const model = new KalmanState();
  const observations = Array.from({ length: 80 }, (_, index) => sample(index, Math.sin(index / 7)));

  for (const observation of observations) {
    accepted(model, observation);
  }

  const expected = model.diagnostics();
  model.reset();
  model.reset();
  assert.equal(model.state(), null);
  assert.deepEqual(model.diagnostics().covariance, [
    [0, 0],
    [0, 0],
  ]);
  accepted(model, observations[0]);
  assert.equal(model.state(), null);

  for (const observation of observations.slice(1)) {
    accepted(model, observation);
  }

  assert.deepEqual(model.diagnostics(), expected);
});

test('input mutations and diagnostic reads cannot change retained state', () => {
  const model = new KalmanState();
  const first = sample(0, 0);
  accepted(model, first);
  first.x = 1000;
  const second = sample(1, 1);
  accepted(model, second);
  second.x = 2000;
  const state = model.state();
  assert.deepEqual(state, { x: 1, y: -0.5, vx: 1, vy: -0.5 });
  assert.equal(Object.isFrozen(state), true);
  assert.throws(() => {
    state.x = 99;
  }, TypeError);
  model.diagnostics().covariance[0][0] = 1000;
  assert.equal(model.state(), state);
  assert.equal(model.diagnostics().covariance[0][0], 0.25);
  accepted(model, sample(2, 2.2));
  assert.deepEqual(state, { x: 1, y: -0.5, vx: 1, vy: -0.5 });
});

test('zero transverse innovation stays exactly zero on long straight trajectories', () => {
  for (const config of [
    { q: 0, r: 0.25 },
    { q: 1e-6, r: 0.01 },
    { q: 0.1, r: 4 },
  ]) {
    const model = new KalmanState(config);

    for (let index = 0; index < 10000; index++) {
      const time = index * 0.05;
      accepted(model, sample(time, 140 + 0.2 * time, 256));
      const state = model.state();

      if (state !== null) {
        assert.equal(state.y, 256);
        assert.equal(state.vy, 0);
        near(state.x + 120 * state.vx, 140 + 0.2 * (time + 120), 1e-9);
      }
    }
  }
});

test('tiny linear coordinates retain their scale without artificial sideways motion', () => {
  const model = new KalmanState();
  const unit = 1e-300;

  for (let time = 0; time < 100; time++) {
    accepted(model, sample(time, time * unit, 20 * unit));
  }

  near(model.state().x / unit, 99, 1e-10);
  near(model.state().vx / unit, 1, 1e-10);
  assert.equal(model.state().y, 20 * unit);
  assert.equal(model.state().vy, 0);
});

test('Joseph covariance stays finite and positive semidefinite across irregular cadences', () => {
  for (const q of [0, 1e-12, 1e-4, 0.1]) {
    for (const r of [1e-12, 0.25, 1e6]) {
      const model = new KalmanState({ q, r });
      let time = 0;

      for (let index = 0; index < 1000; index++) {
        time += [0.0001, 0.125, 1, 8, 32][index % 5];
        accepted(model, sample(time, Math.sin(time / 30) * 20, Math.cos(time / 80) * 10));
        const [[pp, pv], [vp, vv]] = model.diagnostics().covariance;
        assert.ok([pp, pv, vp, vv].every((value) => Number.isFinite(value)));
        assert.equal(pv, vp);
        assert.ok(pp >= 0 && vv >= 0);
        const scale = Math.max(pp * vv, pv * pv, Number.MIN_VALUE);
        assert.ok(pp * vv - pv * pv >= -1e-12 * scale);
        assert.ok(pp <= r * (1 + 1e-12));
      }
    }
  }
});

test('stationary measurement noise is reduced without sustained velocity', () => {
  const model = new KalmanState({ q: 1e-4, r: 0.25 });
  let measuredError = 0;
  let estimatedError = 0;

  for (let time = 0; time < 600; time++) {
    const x = 50 + 0.5 * Math.sin(time * 1.7);
    const y = 70 + 0.5 * Math.cos(time * 2.3);
    accepted(model, sample(time, x, y));

    if (time < 50) {
      continue;
    }

    const estimate = model.state();
    measuredError += (x - 50) ** 2 + (y - 70) ** 2;
    estimatedError += (estimate.x - 50) ** 2 + (estimate.y - 70) ** 2;
  }

  assert.ok(estimatedError < measuredError / 8);
  assert.ok(Math.hypot(model.state().vx, model.state().vy) < 0.05);
});

test('unrepresentable arithmetic rolls back the prior state and covariance', () => {
  const tested = new KalmanState();
  const reference = new KalmanState();
  const coordinate = -Number.MAX_VALUE / 4;

  for (const observation of [sample(0, coordinate, 0), sample(1, coordinate, 0)]) {
    accepted(tested, observation);
    accepted(reference, observation);
  }

  const before = tested.diagnostics();
  assert.equal(tested.update(sample(2, Number.MAX_VALUE, 0)), false);
  assert.deepEqual(tested.diagnostics(), before);
  accepted(tested, sample(2, coordinate, 0));
  accepted(reference, sample(2, coordinate, 0));
  assert.deepEqual(tested.diagnostics(), reference.diagnostics());
});

test('a failed same-time replacement restores the checkpoint before that timestamp', () => {
  const model = new KalmanState();
  const reference = new KalmanState();
  accepted(model, sample(0, 0));
  accepted(model, sample(0.5, 1));
  assert.equal(model.update(sample(0.5, Number.MAX_VALUE)), false);
  assert.equal(model.state(), null);
  assert.equal(model.diagnostics().timeStamp, 0);
  accepted(model, sample(0.5, 2));
  accepted(reference, sample(0, 0));
  accepted(reference, sample(0.5, 2));
  assert.deepEqual(model.diagnostics(), reference.diagnostics());
});

test('an unrepresentable initialization does not poison the next ordinary pair', () => {
  const model = new KalmanState();
  accepted(model, sample(0, 0));
  assert.equal(model.update(sample(Number.MIN_VALUE, 1)), false);
  assert.equal(model.state(), null);
  accepted(model, sample(1, 1));
  assert.deepEqual(model.state(), { x: 1, y: -0.5, vx: 1, vy: -0.5 });
});

test('internal noise configuration requires finite q >= 0 and r > 0', () => {
  for (const config of [
    { q: -1 },
    { q: NaN },
    { q: Infinity },
    { r: 0 },
    { r: -1 },
    { r: Infinity },
    { r: NaN },
  ]) {
    assert.throws(() => new KalmanState(config), RangeError);
  }

  assert.doesNotThrow(() => new KalmanState({ q: 0, r: 1 }));
});
