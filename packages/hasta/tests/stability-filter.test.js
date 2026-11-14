import assert from 'node:assert/strict';
import test from 'node:test';

import { KalmanPredictor as FrozenPredictor } from '../benchmarks/stability/baseline-5cf01cf/core/prediction/kalman-predictor.js';
import { KalmanPredictor } from '../benchmarks/stability/experimental/core/prediction/kalman-predictor.js';
import { KalmanState } from '../benchmarks/stability/experimental/core/prediction/kalman-state.js';

function straight(model) {
  for (let timeStamp = 0; timeStamp <= 100; timeStamp++) {
    model.update({ x: timeStamp, y: 0, timeStamp });
  }
}

test('experimental filter: all modes preserve the exact linear estimate when innovations are small', () => {
  const reference = new FrozenPredictor();
  const robust = new KalmanPredictor({ mode: 'robust' });
  const adaptive = new KalmanPredictor({ mode: 'adaptive' });

  for (let timeStamp = 0; timeStamp < 100; timeStamp++) {
    const point = { x: timeStamp + 0.01 * Math.sin(timeStamp), y: timeStamp / 2, timeStamp };

    for (const model of [reference, robust, adaptive]) {
      model.update(point);
    }

    assert.deepEqual(robust.predict(timeStamp, 120), reference.predict(timeStamp, 120));
    assert.deepEqual(adaptive.predict(timeStamp, 120), reference.predict(timeStamp, 120));
  }
});

test('experimental filter: an isolated transverse outlier has limited forecast influence and retains uncertainty', () => {
  const linear = new KalmanPredictor();
  straight(linear);
  linear.update({ x: 101, y: 24, timeStamp: 101 });
  const originalError = Math.abs(linear.predict(101, 120).points[1].y);

  for (const mode of ['robust', 'adaptive']) {
    const model = new KalmanPredictor({ mode });
    straight(model);
    model.update({ x: 101, y: 24, timeStamp: 101 });
    const error = Math.abs(model.predict(101, 120).points[1].y);
    assert.ok(error < originalError / 20);
    assert.ok(model.diagnostics().innovation.measurementWeight < 0.02);
    assert.equal(model.diagnostics().innovation.processNoiseScale, 1);
    assert.ok(
      model.uncertainty(101).positionVariancePx2 > linear.uncertainty(101).positionVariancePx2,
    );

    for (let timeStamp = 102; timeStamp < 125; timeStamp++) {
      model.update({ x: timeStamp, y: 0, timeStamp });
      assert.equal(model.diagnostics().innovation.processNoiseScale, 1);
    }

    assert.ok(Math.abs(model.predict(124, 120).points[1].y) < 0.1);
  }
});

test('experimental filter: sustained aligned innovations enable bounded adaptation and recover maneuver response', () => {
  const robust = new KalmanPredictor({ mode: 'robust' });
  const adaptive = new KalmanPredictor({ mode: 'adaptive' });
  straight(robust);
  straight(adaptive);
  let robustError = 0;
  let adaptiveError = 0;
  let highestScale = 1;

  for (let timeStamp = 101; timeStamp <= 200; timeStamp++) {
    const point = { x: timeStamp, y: (timeStamp - 100) * 3, timeStamp };
    robust.update(point);
    adaptive.update(point);
    const expectedY = (timeStamp + 120 - 100) * 3;
    robustError += Math.abs(robust.predict(timeStamp, 120).points[1].y - expectedY);
    adaptiveError += Math.abs(adaptive.predict(timeStamp, 120).points[1].y - expectedY);
    const innovation = adaptive.diagnostics().innovation;
    highestScale = Math.max(highestScale, innovation.processNoiseScale);
    assert.ok(innovation.processNoiseScale >= 1 && innovation.processNoiseScale <= 8);

    if (timeStamp < 103) {
      assert.equal(innovation.processNoiseScale, 1);
    }
  }

  assert.ok(highestScale > 1);
  assert.ok(adaptiveError < robustError * 0.7);
  assert.ok(Math.abs(adaptive.diagnostics().state.vy - 3) < 1e-5);
  assert.ok(adaptive.diagnostics().innovation.processNoiseScale < highestScale);
});

test('experimental filter: same-time corrections restore all innovation and adaptation history', () => {
  for (const mode of ['robust', 'adaptive']) {
    const corrected = new KalmanPredictor({ mode });
    const direct = new KalmanPredictor({ mode });
    straight(corrected);
    straight(direct);

    for (let timeStamp = 101; timeStamp < 130; timeStamp++) {
      const point = { x: timeStamp, y: (timeStamp - 100) * 3, timeStamp };
      corrected.update({ ...point, y: point.y - 100 });
      corrected.update(point);
      direct.update(point);
      assert.deepEqual(corrected.diagnostics(), direct.diagnostics());
      assert.deepEqual(corrected.predict(timeStamp, 120), direct.predict(timeStamp, 120));
      assert.deepEqual(corrected.uncertainty(timeStamp, 120), direct.uncertainty(timeStamp, 120));
    }
  }
});

test('experimental filter: numerical failures preserve robust checkpoint metadata', () => {
  for (const mode of ['robust', 'adaptive']) {
    const model = new KalmanState({}, mode);
    const coordinate = -Number.MAX_VALUE / 4;
    model.update({ x: coordinate, y: 0, timeStamp: 0 });
    model.update({ x: coordinate, y: 0, timeStamp: 1 });
    const before = model.diagnostics();
    assert.equal(model.update({ x: Number.MAX_VALUE, y: 0, timeStamp: 2 }), false);
    assert.deepEqual(model.diagnostics(), before);
    assert.equal(model.update({ x: coordinate, y: 0, timeStamp: 2 }), true);
    assert.equal(model.diagnostics().innovation.measurementWeight, 1);
    assert.equal(model.diagnostics().innovation.processNoiseScale, 1);
  }
});

test('experimental filter: robust covariance remains positive semidefinite under irregular outliers and turns', () => {
  for (const mode of ['robust', 'adaptive']) {
    const model = new KalmanState({}, mode);
    let timeStamp = 0;

    for (let index = 0; index < 2000; index++) {
      timeStamp += [0.125, 1, 8, 16][index % 4];
      const outlier = index % 19 === 0 ? 50 : 0;

      const accepted = model.update({
        x: 100 * Math.sin(timeStamp / 50) + outlier,
        y: 100 * Math.cos(timeStamp / 70) - outlier,
        timeStamp,
      });

      assert.ok(accepted);
      const [[pp, pv], [vp, vv]] = model.diagnostics().covariance;
      assert.equal(pv, vp);
      assert.ok([pp, pv, vv].every((value) => Number.isFinite(value)));
      assert.ok(pp >= 0 && vv >= 0);
      assert.ok(pp * vv - pv * pv >= -1e-12 * Math.max(pp * vv, pv * pv, Number.MIN_VALUE));
    }
  }
});

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) <= 1e-10 * Math.max(1, Math.abs(expected)));
}

function seed(model) {
  model.update({ x: 0, y: 0, timeStamp: 0 });
  model.update({ x: 2, y: -2, timeStamp: 2 });
}

test('experimental filter: forecast uncertainty matches the analytic two-observation Gaussian model', () => {
  const model = new KalmanPredictor({}, { q: 0.3, r: 1 });
  seed(model);
  const uncertainty = model.uncertainty(3, 2);
  assert.equal(uncertainty.timeStamp, 2);
  assert.equal(uncertainty.ageMs, 1);
  assert.equal(uncertainty.offsetMs, 2);
  close(uncertainty.positionVariancePx2, 13);
  close(uncertainty.positionStdPx, Math.sqrt(13));
  close(uncertainty.velocityVariancePx2PerMs2, 1.6);
  assert.equal(uncertainty.calibrated, false);
  assert.ok(Object.isFrozen(uncertainty));

  const sameTime = model.uncertainty(5, 0);
  assert.equal(sameTime.positionVariancePx2, uncertainty.positionVariancePx2);
  assert.equal(sameTime.velocityVariancePx2PerMs2, uncertainty.velocityVariancePx2PerMs2);
});

test('experimental filter: external variance scaling changes uncertainty without changing estimates or gains', () => {
  const model = new KalmanPredictor({ varianceScale: 4 });
  const reference = new KalmanPredictor();

  for (let timeStamp = 0; timeStamp < 30; timeStamp++) {
    const point = { x: timeStamp + Math.sin(timeStamp), y: 0, timeStamp };
    model.update(point);
    reference.update(point);
  }

  assert.deepEqual(model.predict(30, 120), reference.predict(30, 120));
  close(model.uncertainty(30, 120).positionStdPx, reference.uncertainty(30, 120).positionStdPx * 2);
  close(
    model.uncertainty(30, 120).velocityVariancePx2PerMs2,
    reference.uncertainty(30, 120).velocityVariancePx2PerMs2 * 4,
  );
  assert.equal(model.uncertainty(30, 120).calibrated, false);
});

test('experimental filter: uncertainty uses assimilated time and refuses covariance for unsupported measured anchors', () => {
  const filtered = new KalmanPredictor({}, { minimumAssimilationDtMs: 2 });

  const measured = new KalmanPredictor(
    {},
    { minimumAssimilationDtMs: 2, positionAnchor: 'measured' },
  );

  seed(filtered);
  seed(measured);
  assert.notEqual(measured.uncertainty(2), null);

  for (const model of [filtered, measured]) {
    model.update({ x: 300, y: 200, timeStamp: 3 });
  }

  assert.equal(filtered.uncertainty(3.5).timeStamp, 2);
  assert.equal(filtered.uncertainty(3.5).ageMs, 1.5);
  assert.equal(measured.uncertainty(3.5), null);

  for (const model of [filtered, measured]) {
    model.update({ x: 4, y: -4, timeStamp: 4 });
  }

  assert.notEqual(filtered.uncertainty(4), null);
  assert.equal(measured.uncertainty(4), null);
});

test('experimental filter: unavailable, expired and failed estimates never produce a confident uncertainty', () => {
  const model = new KalmanPredictor();
  assert.equal(model.uncertainty(0), null);
  seed(model);
  assert.equal(model.uncertainty(1), null);
  assert.equal(model.uncertainty(102), null);
  assert.equal(model.uncertainty(2, Number.MAX_VALUE), null);
  model.update({ x: Number.MAX_VALUE, y: 0, timeStamp: 2.125 });
  assert.equal(model.uncertainty(2.125, 120), null);
  model.update({ x: 2.125, y: -2.125, timeStamp: 2.125 });
  assert.notEqual(model.uncertainty(2.125), null);
  model.reset();
  assert.equal(model.uncertainty(3), null);
});

test('experimental filter: diagnostics are immutable snapshots and uncertainty reads do not alter future estimates', () => {
  const model = new KalmanPredictor({ mode: 'adaptive' });
  const reference = new KalmanPredictor({ mode: 'adaptive' });
  seed(model);
  seed(reference);
  const diagnostics = model.diagnostics();
  assert.throws(() => {
    diagnostics.covariance[0][0] = 100;
  }, TypeError);

  for (let timeStamp = 3; timeStamp < 30; timeStamp++) {
    model.uncertainty(timeStamp, 120);
    const point = { x: timeStamp, y: timeStamp * 3, timeStamp };
    model.update(point);
    reference.update(point);
  }

  assert.equal(diagnostics.sampleCount, 2);
  assert.deepEqual(model.diagnostics(), reference.diagnostics());
});
