import assert from 'node:assert/strict';
import test from 'node:test';

import { GridIndex } from '../dist/runtime/dom/grid-index.js';

const intersects = (a, b) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;

test('grid queries match inclusive linear scans through updates, removal and overflow', () => {
  const index = new GridIndex();
  const entries = new Map();

  const rectangles = [
    { minX: -128, minY: -128, maxX: 0, maxY: 0 },
    { minX: 0, minY: 0, maxX: 128, maxY: 128 },
    { minX: -1e200, minY: -1e200, maxX: 1e200, maxY: 1e200 },
    { minX: 1e150, minY: 1e150, maxX: 2e150, maxY: 2e150 },
  ];

  for (let id = 0; id < 250; id++) {
    const x = ((id * 7919) % 5000) - 2500;
    const y = ((id * 3571) % 5000) - 2500;
    const rect = rectangles[id] ?? { minX: x, minY: y, maxX: x + 300, maxY: y + 200 };
    entries.set(id, rect);
    index.set(id, rect);
  }

  for (let round = 0; round < 3; round++) {
    for (const query of [
      ...entries.values(),
      { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity },
    ]) {
      const expected = new Set();

      for (const [id, rect] of entries) {
        if (intersects(query, rect)) {
          expected.add(id);
        }
      }

      assert.deepEqual(index.query(query), expected);
    }

    for (let id = round; id < 250; id += 3) {
      index.delete(id);
      entries.delete(id);
    }

    const updated = { minX: -400, minY: 200, maxX: -100, maxY: 300 };
    entries.set(1000, updated);
    index.set(1000, updated);
  }
});
