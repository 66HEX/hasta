import assert from 'node:assert/strict';
import test from 'node:test';

import { IntersectionHysteresis } from '../dist/runtime/triggers/intersection-hysteresis.js';

function forecast(vx = 0.2, vy = 0) {
  return {
    generatedAt: 0,
    points: [
      { x: 0, y: 0, offsetMs: 0 },
      { x: vx * 160, y: vy * 160, offsetMs: 160 },
    ],
  };
}

test('only a recent match permits bounded retention and a real match restarts the deadline', () => {
  const state = new IntersectionHysteresis();
  assert.equal(state.retain(0, forecast(), true), false);
  state.match(forecast(), false);
  assert.equal(state.retain(10, forecast(0.19), true), true);
  assert.equal(state.retain(41, forecast(0.19), true), true);
  assert.equal(state.retain(42, forecast(0.19), true), false);
  state.match(forecast(), false);
  assert.equal(state.retain(50, forecast(), true), true);
  state.match(forecast(), false);
  assert.equal(state.retain(80, forecast(), true), true);
  state.reset();
  assert.equal(state.retain(81, forecast(), true), false);
});

test('turns, reversal, braking, stopping and leaving the release boundary cancel immediately', () => {
  for (const [next, near] of [
    [forecast(0, 0.2), true],
    [forecast(-0.2), true],
    [forecast(0.1), true],
    [forecast(0), true],
    [forecast(), false],
  ]) {
    const state = new IntersectionHysteresis();
    state.match(forecast(), false);
    assert.equal(state.retain(1, next, near), false);
    assert.equal(state.retain(2, forecast(), true), false);
  }
});

test('departing observed contact and a stationary match do not gain speculative retention', () => {
  const state = new IntersectionHysteresis();
  state.match(forecast(), true);
  assert.equal(state.retain(0, forecast(), true), false);
  state.match(forecast(0), false);
  assert.equal(state.retain(1, forecast(), true), false);
});
