import assert from 'node:assert/strict';
import test from 'node:test';

import { LinearSpatialIndex } from '../dist/core/index.js';

const origin = { minX: 0, minY: 0, maxX: 10, maxY: 10 };
const distant = { minX: 20, minY: 20, maxX: 30, maxY: 30 };

test('updates by identity and removes stale rectangles', () => {
  const index = new LinearSpatialIndex();
  index.set('button', origin);
  index.set('link', origin);
  assert.deepEqual(index.query(origin), ['button', 'link']);
  index.set('button', distant);
  assert.equal(index.size, 2);
  assert.deepEqual(index.query(origin), ['link']);
  assert.deepEqual(index.query(distant), ['button']);
  assert.equal(index.delete('button'), true);
  assert.equal(index.delete('button'), false);
  assert.deepEqual(index.query(distant), []);
  index.clear();
  assert.equal(index.size, 0);
  assert.deepEqual(index.query(origin), []);
});

test('snapshots registered bounds and preserves the previous entry after an invalid update', () => {
  const index = new LinearSpatialIndex();
  const mutable = { ...origin };
  index.set(1, mutable);
  mutable.minX = 100;
  assert.deepEqual(index.query(origin), [1]);
  assert.throws(() => index.set(1, mutable), RangeError);
  assert.deepEqual(index.query(origin), [1]);
  assert.throws(() => index.query({ ...origin, maxY: Infinity }), RangeError);
});

test('matches an integer-lattice oracle through 500 seeded updates, deletions and clears', () => {
  const index = new LinearSpatialIndex();
  const reference = new Map();
  let seed = 0x27182818;

  const integer = (size) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed % size;
  };

  const rectangle = () => {
    const minX = integer(31) - 15;
    const minY = integer(31) - 15;

    return { minX, minY, maxX: minX + integer(9), maxY: minY + integer(9) };
  };

  function sharesLatticePoint(query, bounds) {
    for (let x = query.minX; x <= query.maxX; x++) {
      for (let y = query.minY; y <= query.maxY; y++) {
        if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
          return true;
        }
      }
    }

    return false;
  }

  for (let step = 0; step < 500; step++) {
    const id = integer(50);

    if (step % 97 === 0) {
      index.clear();
      reference.clear();
    } else if (step % 5 === 0) {
      assert.equal(index.delete(id), reference.delete(id));
    } else {
      const bounds = rectangle();
      reference.set(id, { ...bounds });
      index.set(id, bounds);
      bounds.minX = Infinity;
    }

    const query = rectangle();

    const expected = [];

    for (const [targetId, bounds] of reference) {
      if (sharesLatticePoint(query, bounds)) {
        expected.push(targetId);
      }
    }

    const matches = index.query(query);
    assert.deepEqual(matches, expected, `step ${step}`);
    matches.push('not stored');
    assert.deepEqual(index.query(query), expected);
    assert.equal(index.size, reference.size);
  }
});
