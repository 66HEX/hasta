import assert from 'node:assert/strict';
import test from 'node:test';

import {
  firstSegmentRectIntersection,
  firstTrajectoryRectIntersection,
  intersectsRect,
} from '../dist/core/index.js';

const rect = { minX: 10, minY: 10, maxX: 20, maxY: 20 };

test('finds the first boundary crossing even when both endpoints are outside', () => {
  assert.deepEqual(firstSegmentRectIntersection({ x: 0, y: 15 }, { x: 40, y: 15 }, rect), {
    fraction: 0.25,
    point: { x: 10, y: 15 },
  });
  assert.deepEqual(firstSegmentRectIntersection({ x: 40, y: 15 }, { x: 0, y: 15 }, rect), {
    fraction: 0.5,
    point: { x: 20, y: 15 },
  });
});

test('rejects parallel misses and hits beyond the segment endpoints', () => {
  assert.equal(firstSegmentRectIntersection({ x: 0, y: 9 }, { x: 40, y: 9 }, rect), null);
  assert.equal(firstSegmentRectIntersection({ x: 0, y: 15 }, { x: 5, y: 15 }, rect), null);
  assert.equal(firstSegmentRectIntersection({ x: 30, y: 15 }, { x: 40, y: 15 }, rect), null);
});

test('treats edges, corner touches and stationary points as closed-set intersections', () => {
  assert.deepEqual(firstSegmentRectIntersection({ x: 10, y: 10 }, { x: 10, y: 10 }, rect), {
    fraction: 0,
    point: { x: 10, y: 10 },
  });
  assert.deepEqual(firstSegmentRectIntersection({ x: 0, y: 20 }, { x: 20, y: 0 }, rect), {
    fraction: 0.5,
    point: { x: 10, y: 10 },
  });
  assert.equal(firstSegmentRectIntersection({ x: 0, y: 0 }, { x: 0, y: 0 }, rect), null);
  assert.equal(intersectsRect(rect, { minX: 20, minY: 20, maxX: 30, maxY: 30 }), true);
});

test('returns the earliest interpolated time on a polyline', () => {
  assert.deepEqual(
    firstTrajectoryRectIntersection(
      [
        { x: 0, y: 0, offsetMs: 0 },
        { x: 0, y: 15, offsetMs: 10 },
        { x: 40, y: 15, offsetMs: 30 },
        { x: 0, y: 15, offsetMs: 60 },
      ],
      rect,
    ),
    { offsetMs: 15, point: { x: 10, y: 15 } },
  );
  assert.equal(firstTrajectoryRectIntersection([], rect), null);
  assert.deepEqual(firstTrajectoryRectIntersection([{ x: 15, y: 15, offsetMs: 0 }], rect), {
    offsetMs: 0,
    point: { x: 15, y: 15 },
  });
});

test('rejects malformed bounds, non-finite points and non-monotonic trajectory times', () => {
  assert.throws(() => intersectsRect(rect, { ...rect, minX: 30 }), RangeError);
  assert.throws(
    () => firstSegmentRectIntersection({ x: NaN, y: 15 }, { x: 15, y: 15 }, rect),
    RangeError,
  );

  for (const offsetMs of [0, -1, Infinity]) {
    assert.throws(
      () =>
        firstTrajectoryRectIntersection(
          [
            { x: 15, y: 15, offsetMs: 0 },
            { x: 20, y: 20, offsetMs },
          ],
          rect,
        ),
      RangeError,
    );
  }
});

test('rejects finite coordinates whose differences overflow instead of returning a NaN hit', () => {
  assert.throws(
    () =>
      firstSegmentRectIntersection(
        { x: -Number.MAX_VALUE, y: 15 },
        { x: Number.MAX_VALUE, y: 15 },
        rect,
      ),
    RangeError,
  );
});

test('handles point and line rectangles, reversed diagonals and subnormal motion', () => {
  assert.deepEqual(
    firstSegmentRectIntersection(
      { x: 0, y: 0 },
      { x: 20, y: 20 },
      {
        minX: 10,
        maxX: 10,
        minY: 10,
        maxY: 10,
      },
    ),
    { fraction: 0.5, point: { x: 10, y: 10 } },
  );
  assert.deepEqual(
    firstSegmentRectIntersection(
      { x: 20, y: 0 },
      { x: 0, y: 20 },
      {
        minX: 10,
        maxX: 10,
        minY: 5,
        maxY: 15,
      },
    ),
    { fraction: 0.5, point: { x: 10, y: 10 } },
  );
  assert.equal(
    firstSegmentRectIntersection({ x: 0, y: 0 }, { x: Number.MIN_VALUE, y: 0 }, rect),
    null,
  );
  assert.deepEqual(
    firstSegmentRectIntersection(
      { x: 0, y: 0 },
      { x: Number.MIN_VALUE, y: 0 },
      {
        minX: Number.MIN_VALUE,
        maxX: Number.MIN_VALUE,
        minY: 0,
        maxY: 0,
      },
    ),
    { fraction: 1, point: { x: Number.MIN_VALUE, y: 0 } },
  );
});

test('validates the entire trajectory even when its first point already intersects', () => {
  for (const invalid of [
    { x: NaN, y: 15, offsetMs: 1 },
    { x: 15, y: 15, offsetMs: NaN },
    { x: 15, y: 15, offsetMs: -1 },
  ]) {
    assert.throws(
      () => firstTrajectoryRectIntersection([{ x: 15, y: 15, offsetMs: 0 }, invalid], rect),
      RangeError,
    );
  }
});

test('agrees with independent edge-crossing intersections for 4000 seeded segments', () => {
  let seed = 0x31415926;

  const integer = (size) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed % size;
  };

  const inside = (point, box) =>
    point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;

  function expected(start, end, box) {
    if (inside(start, box)) {
      return 0;
    }

    const candidates = [];

    if (end.x !== start.x) {
      for (const x of [box.minX, box.maxX]) {
        const t = (x - start.x) / (end.x - start.x);
        const y = start.y + t * (end.y - start.y);

        if (t >= 0 && t <= 1 && y >= box.minY - 1e-10 && y <= box.maxY + 1e-10) {
          candidates.push(t);
        }
      }
    }

    if (end.y !== start.y) {
      for (const y of [box.minY, box.maxY]) {
        const t = (y - start.y) / (end.y - start.y);
        const x = start.x + t * (end.x - start.x);

        if (t >= 0 && t <= 1 && x >= box.minX - 1e-10 && x <= box.maxX + 1e-10) {
          candidates.push(t);
        }
      }
    }

    return candidates.length > 0 ? Math.min(...candidates) : null;
  }

  for (let sample = 0; sample < 4000; sample++) {
    const start = { x: integer(101) - 50, y: integer(101) - 50 };
    const end = { x: integer(101) - 50, y: integer(101) - 50 };
    const box = { minX: integer(61) - 30, minY: integer(61) - 30 };
    box.maxX = box.minX + integer(31);
    box.maxY = box.minY + integer(31);
    const fraction = expected(start, end, box);
    const hit = firstSegmentRectIntersection(start, end, box);
    const description = JSON.stringify({ sample, start, end, box });
    assert.equal(hit === null, fraction === null, description);

    if (hit) {
      assert.ok(Math.abs(hit.fraction - fraction) < 1e-12, description);
      assert.ok(hit.point.x >= box.minX - 1e-10 && hit.point.x <= box.maxX + 1e-10, description);
      assert.ok(hit.point.y >= box.minY - 1e-10 && hit.point.y <= box.maxY + 1e-10, description);

      const trajectoryHit = firstTrajectoryRectIntersection(
        [
          { ...start, offsetMs: 10 },
          { ...end, offsetMs: 90 },
        ],
        box,
      );

      assert.ok(Math.abs(trajectoryHit.offsetMs - (10 + 80 * fraction)) < 1e-10, description);
    }
  }
});

test('returns points inside thin rectangles without a spatial epsilon', () => {
  let seed = 0x273641;

  const coordinate = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return (seed / 2 ** 32) * 600;
  };

  const box = { minX: 200, minY: 200, maxX: 201, maxY: 400 };
  let hits = 0;

  for (let sample = 0; sample < 10000; sample++) {
    const start = { x: coordinate(), y: coordinate() };
    const end = { x: coordinate(), y: coordinate() };
    const hit = firstSegmentRectIntersection(start, end, box);

    if (hit) {
      hits++;
      assert.ok(hit.point.x >= box.minX && hit.point.x <= box.maxX, JSON.stringify(hit));
      assert.ok(hit.point.y >= box.minY && hit.point.y <= box.maxY, JSON.stringify(hit));
    }
  }

  assert.ok(hits > 100);
});
