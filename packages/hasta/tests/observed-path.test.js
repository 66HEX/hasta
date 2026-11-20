import assert from 'node:assert/strict';
import test from 'node:test';

import { ObservedPath } from '../dist/runtime/input/observed-path.js';

const sample = (timeStamp, x, y = 0) => ({ timeStamp, x, y });

test('observed paths retain corners and reversals, and are consumed only once', () => {
  const path = new ObservedPath(100);
  const points = [sample(0, 0), sample(10, 100), sample(20, 100, 100), sample(30, 0, 100)];
  points.forEach((point) => path.push(point));
  assert.deepEqual(path.take(30), points);
  assert.deepEqual(path.take(31), []);
  path.push(sample(40, 0));
  assert.deepEqual(path.take(40), [points.at(-1), sample(40, 0)]);
});

test('same-time replacement discards the old coordinate without losing earlier corners', () => {
  const path = new ObservedPath(100);
  [sample(0, 0), sample(10, 100), sample(20, 200), sample(20, 100, 100)].forEach((point) =>
    path.push(point),
  );
  assert.deepEqual(path.take(20), [sample(0, 0), sample(10, 100), sample(20, 100, 100)]);
});

test('expired segments are clipped by time instead of replaying an old crossing', () => {
  const path = new ObservedPath(100);
  [sample(0, 0), sample(20, 20), sample(80, 80), sample(120, 120)].forEach((point) =>
    path.push(point),
  );
  assert.deepEqual(path.take(150), [sample(50, 50), sample(80, 80), sample(120, 120)]);
  path.push(sample(130, 130));
  assert.deepEqual(path.take(230), []);
});

test('out-of-order observations cannot change a pending path', () => {
  const path = new ObservedPath(100);
  [sample(0, 0), sample(20, 20), sample(10, 1000)].forEach((point) => path.push(point));
  assert.deepEqual(path.take(20), [sample(0, 0), sample(20, 20)]);
});

test('clearing a session removes its retained endpoint', () => {
  const path = new ObservedPath(100);
  path.push(sample(0, 100));
  path.take(0);
  path.clear();
  path.push(sample(10, 0));
  assert.deepEqual(path.take(10), [sample(10, 0)]);
});

test('a long event burst preserves every fresh turn while expiring old movement', () => {
  const path = new ObservedPath(100);

  for (let index = 0; index <= 100_000; index++) {
    path.push(sample(index / 10, index % 2 ? 100 : 0));
  }

  const points = path.take(10_000);
  assert.equal(points.length, 1001);
  assert.deepEqual(points[0], sample(9900, 0));
  assert.deepEqual(points.at(-1), sample(10_000, 0));
  assert.ok(points.every((point, index) => point.x === (index % 2 ? 100 : 0)));
});

test('clipped segment endpoints remain finite when coordinate differences overflow', () => {
  const path = new ObservedPath(100);
  [
    sample(0, -Number.MAX_VALUE, Number.MAX_VALUE),
    sample(100, Number.MAX_VALUE, -Number.MAX_VALUE),
  ].forEach((point) => path.push(point));
  const points = path.take(150);
  assert.equal(points.length, 2);
  assert.ok(Number.isFinite(points[0].x) && Number.isFinite(points[0].y));
  assert.equal(points[0].timeStamp, 50);
});
