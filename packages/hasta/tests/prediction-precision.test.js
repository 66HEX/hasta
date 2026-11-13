import assert from 'node:assert/strict';
import test from 'node:test';

import { ConstantVelocityPredictor } from '../dist/core/index.js';

test('fractional sample intervals do not turn exact corner contacts into misses', () => {
  for (const dt of [0.1, 0.2, 0.3, 0.7, 1.1, 4.1, 7.25, 13.37]) {
    for (const dx of [-29, -7, -3, -1, 1, 3, 7, 29]) {
      for (const dy of [-29, -7, -3, -1, 1, 3, 7, 29]) {
        const predictor = new ConstantVelocityPredictor();
        predictor.update({ x: 0, y: 0, timeStamp: 0 });
        predictor.update({ x: dx, y: dy, timeStamp: dt });

        const rect = {
          minX: Math.min(3 * dx, 4 * dx),
          maxX: Math.max(3 * dx, 4 * dx),
          minY: Math.min(0, 3 * dy),
          maxY: Math.max(0, 3 * dy),
        };

        for (const age of [0, dt / 2, dt]) {
          const now = dt + age;
          const eta = 2 * dt - (now - dt);
          const expected = { offsetMs: eta, point: { x: 3 * dx, y: 3 * dy } };
          assert.deepEqual(predictor.intersectRect(now, eta, rect), expected);
          assert.deepEqual(predictor.intersectRect(now, 120, rect), expected);
        }
      }
    }
  }
});

test('nearly equal crossing ratios retain a real gap across coordinate scales', () => {
  const n = 2 ** 28;

  for (const scale of [2 ** -600, 2 ** -20, 1, 2 ** 500]) {
    const predictor = new ConstantVelocityPredictor();
    predictor.update({ x: -n * scale, y: -(n - 1) * scale, timeStamp: 0 });
    predictor.update({ x: 0, y: 0, timeStamp: 1 });
    // (n - 1) / n exceeds (n - 2) / (n - 1) even when both round to the same double
    assert.equal(
      predictor.intersectRect(1, 1, {
        minX: (n - 1) * scale,
        maxX: n * scale,
        minY: 0,
        maxY: (n - 2) * scale,
      }),
      null,
    );
  }
});

test('corner ETAs are independent of forecast length, frame age and direction', () => {
  for (const dx of [-11, -3, -1, 1, 3, 11]) {
    for (const dy of [-7, -1, 1, 7]) {
      for (const dt of [3, 7, 13, 49]) {
        const predictor = new ConstantVelocityPredictor();
        predictor.update({ x: 0, y: 0, timeStamp: 1000 });
        predictor.update({ x: dx, y: dy, timeStamp: 1000 + dt });

        const box = {
          minX: Math.min(2 * dx, 3 * dx),
          maxX: Math.max(2 * dx, 3 * dx),
          minY: Math.min(0, 2 * dy),
          maxY: Math.max(0, 2 * dy),
        };

        for (const age of [0, dt / 4, (dt * 3) / 4]) {
          for (const horizon of [dt, 60, 120, 1e6]) {
            assert.deepEqual(predictor.intersectRect(1000 + dt + age, horizon, box), {
              offsetMs: dt - age,
              point: { x: 2 * dx, y: 2 * dy },
            });
          }
        }
      }
    }
  }
});

test('corner misses stay misses down to a representable gap without enlarging targets', () => {
  const predictor = new ConstantVelocityPredictor();
  predictor.update({ x: 0, y: 0, timeStamp: 0 });
  predictor.update({ x: 3, y: 1, timeStamp: 7 });

  for (const gap of [1 / 32, 1 / 1024, 1e-9, Number.EPSILON]) {
    for (const horizon of [7, 120, 1e6]) {
      assert.equal(
        predictor.intersectRect(7, horizon, { minX: 6, maxX: 7, minY: 0, maxY: 2 - gap }),
        null,
      );
    }
  }
});

test('prediction intersections honor warmup, expiry, replacement, reset and overflow', () => {
  const predictor = new ConstantVelocityPredictor();
  const box = { minX: 2, maxX: 3, minY: 0, maxY: 6 };
  assert.equal(predictor.intersectRect(0, 120, box), null);
  predictor.update({ x: 0, y: 0, timeStamp: 0 });
  assert.equal(predictor.intersectRect(0, 120, box), null);
  predictor.update({ x: 1, y: 3, timeStamp: 3 });
  assert.equal(predictor.intersectRect(2, 120, box), null);
  assert.equal(predictor.intersectRect(3, 2, box), null);
  assert.deepEqual(predictor.intersectRect(3, 3, box), { offsetMs: 3, point: { x: 2, y: 6 } });
  assert.equal(predictor.intersectRect(103, 120, box), null);
  predictor.update({ x: -1, y: -3, timeStamp: 3 });
  assert.equal(predictor.intersectRect(3, 120, box), null);
  predictor.reset();
  assert.equal(predictor.intersectRect(3, 120, box), null);
  predictor.update({ x: 0, y: 0, timeStamp: 0 });
  predictor.update({ x: Number.MAX_VALUE / 2, y: 0, timeStamp: 1 });
  assert.equal(predictor.intersectRect(1, 120, box), null);

  for (const horizon of [0, -1, NaN, Infinity]) {
    assert.throws(() => predictor.intersectRect(1, horizon, box), RangeError);
  }

  assert.throws(() => predictor.intersectRect(NaN, 120, box), RangeError);
  assert.throws(() => predictor.intersectRect(1, 120, { ...box, maxY: -1 }), RangeError);
});

test('stationary and subnormal motion have finite contact points and ETAs', () => {
  const predictor = new ConstantVelocityPredictor();
  const box = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  predictor.update({ x: 0.5, y: 0.5, timeStamp: 0 });
  predictor.update({ x: 0.5, y: 0.5, timeStamp: Number.MIN_VALUE });
  assert.deepEqual(predictor.intersectRect(50, 120, box), {
    offsetMs: 0,
    point: { x: 0.5, y: 0.5 },
  });
  predictor.reset();
  predictor.update({ x: 0, y: 0, timeStamp: 0 });
  predictor.update({ x: Number.MIN_VALUE, y: 0, timeStamp: 1 });
  assert.equal(predictor.intersectRect(1, 120, { ...box, minX: 1 }), null);
});

test('finite intersection times survive overflow and underflow in intermediate products', () => {
  const predictor = new ConstantVelocityPredictor();
  predictor.update({ x: -1e308, y: 0, timeStamp: 0 });
  predictor.update({ x: 0, y: 0, timeStamp: 50 });
  assert.deepEqual(
    predictor.intersectRect(50, 10, { minX: 1e307, maxX: 1.5e307, minY: 0, maxY: 1 }),
    {
      offsetMs: 5,
      point: { x: 1e307, y: 0 },
    },
  );
  predictor.reset();
  predictor.update({ x: 0, y: 0, timeStamp: 0 });
  predictor.update({ x: Number.MIN_VALUE, y: 0, timeStamp: Number.MIN_VALUE });
  assert.deepEqual(
    predictor.intersectRect(Number.MIN_VALUE, 1, {
      minX: Number.MIN_VALUE * 10,
      maxX: 1,
      minY: 0,
      maxY: 1,
    }),
    {
      offsetMs: Number.MIN_VALUE * 9,
      point: { x: Number.MIN_VALUE * 10, y: 0 },
    },
  );
});

test('a partially underflowing product cannot shift a contact past its horizon', () => {
  const dx = 2 ** -1000;
  const dt = 2 ** -74;
  const predictor = new ConstantVelocityPredictor();
  predictor.update({ x: 0, y: 0, timeStamp: 0 });
  predictor.update({ x: dx, y: 0, timeStamp: dt });
  const rect = { minX: 2.5 * dx, maxX: 3 * dx, minY: 0, maxY: 1 };
  assert.deepEqual(predictor.intersectRect(dt, 1.5 * dt, rect), {
    offsetMs: 1.5 * dt,
    point: { x: 2.5 * dx, y: 0 },
  });
  assert.equal(predictor.intersectRect(dt, 1.25 * dt, rect), null);
});

test('exact horizon boundaries and current contact do not drift with sampling cadence', () => {
  for (let dt = 1; dt < 100; dt++) {
    const predictor = new ConstantVelocityPredictor();
    predictor.update({ x: -dt, y: -dt, timeStamp: 0 });
    predictor.update({ x: 0, y: 0, timeStamp: dt });

    for (let distance = 1; distance < 100; distance++) {
      const box = { minX: distance, maxX: distance + 1, minY: distance - 1, maxY: distance };
      assert.deepEqual(predictor.intersectRect(dt, distance, box), {
        offsetMs: distance,
        point: { x: distance, y: distance },
      });
      assert.deepEqual(predictor.intersectRect(dt + distance, 120, box), {
        offsetMs: 0,
        point: { x: distance, y: distance },
      });
      assert.equal(predictor.intersectRect(dt, distance - 1 / 1024, box), null);
    }
  }
});

// The oracle works in integer subpixel units and compares edge crossings as exact fractions
function referenceIntersection(sample, dx, dy, dt, age, horizon, box) {
  const currentX = BigInt(sample.x * dt + dx * age);
  const currentY = BigInt(sample.y * dt + dy * age);
  const duration = BigInt(dt);

  if (
    currentX >= BigInt(box.minX) * duration &&
    currentX <= BigInt(box.maxX) * duration &&
    currentY >= BigInt(box.minY) * duration &&
    currentY <= BigInt(box.maxY) * duration
  ) {
    return 0;
  }

  let earliest = null;

  for (const [position, delta, otherPosition, otherDelta, boundaries, low, high] of [
    [sample.x, dx, sample.y, dy, [box.minX, box.maxX], box.minY, box.maxY],
    [sample.y, dy, sample.x, dx, [box.minY, box.maxY], box.minX, box.maxX],
  ]) {
    if (delta === 0) {
      continue;
    }

    for (const boundary of boundaries) {
      const sign = delta < 0 ? -1 : 1;
      const n = BigInt((boundary - position) * sign);
      const d = BigInt(delta * sign);
      const other = BigInt(otherPosition) * d + BigInt(otherDelta) * n;
      const time = n * duration;

      if (
        other < BigInt(low) * d ||
        other > BigInt(high) * d ||
        time < BigInt(age) * d ||
        time > BigInt(age + horizon) * d
      ) {
        continue;
      }

      if (earliest === null || time * earliest.d < earliest.n * d) {
        earliest = { n: time, d };
      }
    }
  }

  return earliest === null ? null : Number(earliest.n) / Number(earliest.d) - age;
}

test('matches exact edge-crossing arithmetic on 10000 seeded subpixel tracks', () => {
  let seed = 0x741538;

  const integer = (max) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed % max;
  };

  let hits = 0;

  for (let run = 0; run < 10000; run++) {
    const sample = { x: integer(1001) - 500, y: integer(1001) - 500 };
    const dx = integer(401) - 200;
    const dy = integer(401) - 200;
    const dt = 1 + integer(50);
    const age = integer(90);
    const horizon = 1 + integer(300);
    const box = { minX: integer(1001) - 500, minY: integer(1001) - 500 };
    box.maxX = box.minX + 1 + integer(300);
    box.maxY = box.minY + 1 + integer(300);
    const predictor = new ConstantVelocityPredictor();
    predictor.update({ x: (sample.x - dx) / 64, y: (sample.y - dy) / 64, timeStamp: 0 });
    predictor.update({ x: sample.x / 64, y: sample.y / 64, timeStamp: dt });
    const rect = Object.fromEntries(Object.entries(box).map(([key, value]) => [key, value / 64]));
    const expected = referenceIntersection(sample, dx, dy, dt, age, horizon, box);
    const actual = predictor.intersectRect(dt + age, horizon, rect);
    const description = JSON.stringify({ sample, dx, dy, dt, age, horizon, box, actual, expected });
    assert.equal(actual === null, expected === null, description);

    if (actual !== null) {
      hits++;
      assert.ok(Math.abs(actual.offsetMs - expected) < 1e-10, description);
      assert.ok(actual.point.x >= rect.minX && actual.point.x <= rect.maxX, description);
      assert.ok(actual.point.y >= rect.minY && actual.point.y <= rect.maxY, description);
    }
  }

  assert.ok(hits > 100);
});
