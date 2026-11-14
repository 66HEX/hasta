import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PreviousPredictor,
  KalmanPredictor,
  summarizeSteady,
  responseReplay,
  steadyReplay,
} from '../benchmarks/stability/cursor-jitter.mjs';

for (const dt of [1, 4, 8, 1000 / 60, 33]) {
  test(`steady motion at ${dt} ms reduces endpoint jitter without losing target acquisition`, () => {
    for (const profile of ['noise', 'quantized', 'jitter']) {
      const options = {
        dt,
        noise: profile === 'quantized' ? 0 : 0.5,
        quantize: profile === 'quantized',
        jitter: profile === 'jitter',
      };

      const before = summarizeSteady(PreviousPredictor, options);
      const after = summarizeSteady(KalmanPredictor, { ...options, hysteresis: true });
      assert.ok(after.rmse < before.rmse * 0.6, JSON.stringify({ profile, before, after }));
      assert.ok(after.meanBackwards <= before.meanBackwards * 0.5);
      assert.ok(after.repeatedStarts <= before.repeatedStarts);
      assert.equal(after.missed, 0);
      assert.ok(after.meanLeadMs >= 120);
    }
  });
}

test('the reported 8 ms constant-motion reproduction no longer chatters', () => {
  const before = summarizeSteady(PreviousPredictor);
  const filtered = summarizeSteady(KalmanPredictor);
  assert.ok(before.repeatedStarts >= 40);
  assert.equal(filtered.repeatedStarts, 0);
  assert.ok(filtered.rmse < 1.1);
  const clean = steadyReplay(KalmanPredictor, { noise: 0 });
  assert.ok(clean.rmse < 1e-9);
  assert.equal(clean.backwards, 0);
});

test('turns and braking settle quickly across speeds and sampling cadences', () => {
  for (const dt of [1, 4, 8, 1000 / 60, 33]) {
    for (const speed of [0.1, 0.2, 1]) {
      for (const kind of ['turn', 'brake', 'stop', 'reverse']) {
        const options = { dt, speed, kind };
        const before = responseReplay(PreviousPredictor, options);
        const after = responseReplay(KalmanPredictor, options);
        const description = JSON.stringify({ ...options, before, after });
        assert.ok(after <= Math.max(48, 3 * dt) + 1e-9, description);
        assert.ok(after <= before + Math.max(32, dt) + 1e-9, description);
      }
    }
  }
});
