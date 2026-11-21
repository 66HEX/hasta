import assert from 'node:assert/strict';
import test from 'node:test';

import { firstTrajectoryRectIntersection } from '../dist/core/geometry.js';
import { KalmanPredictor } from '../dist/core/prediction/kalman-predictor.js';
import { GridIndex } from '../dist/runtime/dom/grid-index.js';
import { normalizeHastaOptions } from '../dist/runtime/options.js';
import {
  Subscription,
  normalizeSubscriptionOptions,
} from '../dist/runtime/triggers/subscription.js';

test('normalizeSubscriptionOptions and normalizeHastaOptions reject non-plain objects including arrays', () => {
  for (const invalid of [null, [], ['x'], 42, 'invalid', true]) {
    assert.throws(() => normalizeSubscriptionOptions(invalid), TypeError);
    assert.throws(() => normalizeHastaOptions(invalid), TypeError);
  }

  assert.throws(() => normalizeSubscriptionOptions({ stableForMs: -1 }), RangeError);
  assert.throws(() => normalizeSubscriptionOptions({ cooldownMs: Number.NaN }), RangeError);
});

test('Subscription prepare and commit coordinate stability, cooldown, corroboration, and abort reasons', () => {
  const events = [];
  const errors = [];
  const stateChanges = [];

  const sub = new Subscription(
    (event) => {
      events.push(event);
    },
    { stableForMs: 20, cooldownMs: 50 },
    (error) => {
      errors.push(error);
    },
    undefined,
    (active) => {
      stateChanges.push(active);
    },
  );

  // First match starts stability window without committing yet
  assert.equal(sub.prepare(true, 100, true, 100), false);
  assert.deepEqual(stateChanges, [true]);

  // Repeated stale evidence time cannot corroborate even after wait
  assert.equal(sub.prepare(true, 130, true, 100), false);

  // New evidence time at >= 120ms commits once
  assert.equal(sub.prepare(true, 125, true, 125), true);
  const run = sub.commit({ id: 7 }, 125);
  run();

  assert.equal(events.length, 1);
  assert.equal(Object.isFrozen(events[0]), true);
  assert.equal(events[0].id, 7);
  assert.equal(events[0].signal.aborted, false);

  // While latched, prepare returns false without touching listeners
  assert.equal(sub.prepare(true, 135, true, 135), false);

  // Explicit error invalidation preserves 'error' reason
  sub.invalidate('error');
  assert.equal(events[0].signal.aborted, true);
  assert.equal(events[0].signal.reason, 'error');
  assert.deepEqual(stateChanges, [true, false]);

  // Cooldown suppresses firing even when newly stabilized
  assert.equal(sub.prepare(true, 150, true, 150), false);
  assert.equal(sub.prepare(true, 174, true, 174), false);
  assert.equal(sub.prepare(true, 175, true, 175), true);
  assert.deepEqual(errors, []);
});

test('GridIndex packed cell keys remain exact across negative, zero, boundary, and large offsets', () => {
  const index = new GridIndex();

  const boxes = new Map([
    [1, { minX: -500_000, minY: -500_000, maxX: -499_800, maxY: -499_750 }],
    [2, { minX: 127.9, minY: 127.9, maxX: 128.1, maxY: 128.1 }],
    [3, { minX: -200, minY: -200, maxX: 200, maxY: 200 }],
    [4, { minX: 4_000_000, minY: -3_000_000, maxX: 4_000_400, maxY: -2_999_600 }],
  ]);

  for (const [id, rect] of boxes) {
    index.set(id, rect);
  }

  // Exact cell boundary touch across negative and positive origins
  assert.deepEqual(
    [...index.query({ minX: 128, minY: 128, maxX: 128, maxY: 128 })].toSorted(),
    [2, 3],
  );

  // Large negative coordinate lookup
  assert.deepEqual(
    [...index.query({ minX: -500_050, minY: -500_050, maxX: -499_950, maxY: -499_950 })],
    [1],
  );

  // Large mixed-sign coordinate lookup
  assert.deepEqual(
    [...index.query({ minX: 4_000_100, minY: -2_999_900, maxX: 4_000_500, maxY: -2_999_500 })],
    [4],
  );

  // Moving a rect removes old cell entries cleanly
  index.set(1, { minX: 1000, minY: 1000, maxX: 1100, maxY: 1100 });
  assert.deepEqual(
    [...index.query({ minX: -500_050, minY: -500_050, maxX: -499_950, maxY: -499_950 })],
    [],
  );
  assert.deepEqual([...index.query({ minX: 1050, minY: 1050, maxX: 1060, maxY: 1060 })], [1]);

  // Deleting removes every cell occupied by a multi-cell rect
  index.delete(3);
  assert.deepEqual([...index.query({ minX: -150, minY: -150, maxX: 150, maxY: 150 })], [2]);
});

test('KalmanPredictor multi-horizon cache matches linear projection and invalidates on time, update, and reset', () => {
  const predictor = new KalmanPredictor({ maxSampleAgeMs: 250 });

  for (let index = 0; index <= 5; index++) {
    const t = index * 16;
    predictor.update({ x: 100 + t * 0.5, y: 200 - t * 0.25, timeStamp: t });
  }

  const now = 84;
  const f50 = predictor.predict(now, 50);
  const f150 = predictor.predict(now, 150);
  const f300 = predictor.predict(now, 300);

  assert.ok(f50 && f150 && f300);
  assert.equal(f50.points[0].x, f150.points[0].x);
  assert.equal(f50.points[0].y, f150.points[0].y);
  assert.equal(f150.points[0].x, f300.points[0].x);
  assert.equal(f150.points[0].y, f300.points[0].y);

  const dx50 = f50.points[1].x - f50.points[0].x;
  const dx150 = f150.points[1].x - f150.points[0].x;
  const dx300 = f300.points[1].x - f300.points[0].x;
  assert.ok(Math.abs(dx150 - dx50 * 3) < 1e-9);
  assert.ok(Math.abs(dx300 - dx50 * 6) < 1e-9);

  // Querying at a different timestamp must recompute anchor and invalidate prior base
  const later = predictor.predict(100, 150);
  assert.ok(later);
  assert.notEqual(later.points[0].x, f150.points[0].x);

  // Updating invalidates cached base even if queried again at an equal timestamp
  predictor.update({ x: 300, y: 50, timeStamp: 96 });
  const updated = predictor.predict(100, 150);
  assert.ok(updated);
  assert.notEqual(updated.points[0].x, later.points[0].x);

  // Resetting clears prior trajectory and reuses internal state cleanly
  predictor.reset();
  assert.equal(predictor.predict(100, 150), null);

  predictor.update({ x: 10, y: 10, timeStamp: 200 });
  predictor.update({ x: 10, y: 10, timeStamp: 216 });
  const stationary = predictor.predict(220, 100);
  assert.ok(stationary);
  assert.ok(Math.hypot(stationary.points[1].x - 10, stationary.points[1].y - 10) < 1e-6);
});

test('firstTrajectoryRectIntersection handles short trajectories and multi-segment paths', () => {
  const rect = { minX: 100, minY: 0, maxX: 150, maxY: 50 };

  assert.equal(firstTrajectoryRectIntersection([], rect), null);
  assert.equal(firstTrajectoryRectIntersection([{ x: 10, y: 20, offsetMs: 5 }], rect), null);
  assert.deepEqual(firstTrajectoryRectIntersection([{ x: 120, y: 20, offsetMs: 10 }], rect), {
    offsetMs: 10,
    point: { x: 120, y: 20 },
  });

  const secondSegmentHit = firstTrajectoryRectIntersection(
    [
      { x: 0, y: 20, offsetMs: 0 },
      { x: 50, y: 20, offsetMs: 10 },
      { x: 200, y: 20, offsetMs: 40 },
    ],
    rect,
  );

  assert.deepEqual(secondSegmentHit, {
    offsetMs: 20,
    point: { x: 100, y: 20 },
  });
});
