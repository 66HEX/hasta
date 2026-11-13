import assert from 'node:assert/strict';
import test from 'node:test';

import { KalmanPredictor } from '../dist/core/index.js';

function sample(timeStamp, x, y = 0) {
  return { timeStamp, x, y };
}

const variants = [
  { name: 'public', create: () => new KalmanPredictor() },
  {
    name: 'filtered with cadence',
    create: () =>
      new KalmanPredictor({}, { minimumAssimilationDtMs: 0.125, positionAnchor: 'filtered' }),
  },
  {
    name: 'measured with cadence',
    create: () =>
      new KalmanPredictor({}, { minimumAssimilationDtMs: 0.125, positionAnchor: 'measured' }),
  },
];

const rects = [
  { minX: 10, maxX: 15, minY: -1, maxY: 1 },
  { minX: -15, maxX: -10, minY: -1, maxY: 1 },
];

function equivalent(tested, reference, timeStamp, label) {
  for (const age of [0, 0.0625]) {
    const now = timeStamp + age;

    for (const horizon of [1, 10, 60]) {
      const expected = reference.predict(now, horizon);
      assert.notEqual(expected, null, label);
      assert.deepEqual(tested.predict(now, horizon), expected, label);

      for (const rect of rects) {
        assert.deepEqual(
          tested.intersectRect(now, horizon, rect),
          reference.intersectRect(now, horizon, rect),
          label,
        );
      }
    }
  }
}

test('a failed new timestamp can be corrected without losing earlier filtering history', () => {
  const observations = [sample(0, 0), sample(0.125, 1), sample(0.25, 0.5), sample(0.375, 0.75)];

  for (const variant of variants) {
    for (const failureIndex of [2, 3]) {
      const tested = variant.create();
      const reference = variant.create();

      for (const observation of observations.slice(0, failureIndex)) {
        tested.update(observation);
        reference.update(observation);
      }

      const correction = observations[failureIndex];
      tested.update(sample(correction.timeStamp, Number.MAX_VALUE));
      assert.equal(tested.predict(correction.timeStamp, 10), null, variant.name);
      tested.update(correction);
      reference.update(correction);
      equivalent(tested, reference, correction.timeStamp, variant.name);
    }
  }
});

test('failed replacement of a committed timestamp can recover either its old or new coordinates', () => {
  for (const variant of variants) {
    for (const correctedX of [0.5, 0.75]) {
      const tested = variant.create();
      const reference = variant.create();

      for (const observation of [sample(0, 0), sample(0.125, 1)]) {
        tested.update(observation);
        reference.update(observation);
      }

      tested.update(sample(0.25, 0.5));
      tested.update(sample(0.25, Number.MAX_VALUE));
      tested.update(sample(0.25, Number.MAX_VALUE));
      assert.equal(tested.predict(0.25, 10), null, variant.name);
      tested.update(sample(0.25, correctedX));
      reference.update(sample(0.25, correctedX));
      equivalent(tested, reference, 0.25, variant.name);
    }
  }
});

test('continuing after a corrected failure preserves covariance and timestamp bookkeeping', () => {
  for (const variant of variants) {
    for (const alreadyCommitted of [false, true]) {
      const tested = variant.create();
      const reference = variant.create();

      for (const observation of [sample(0, 0), sample(0.125, 1)]) {
        tested.update(observation);
        reference.update(observation);
      }

      if (alreadyCommitted) {
        tested.update(sample(0.25, 0.1));
      }

      tested.update(sample(0.25, Number.MAX_VALUE));
      tested.update(sample(0.25, 0.5));
      reference.update(sample(0.25, 0.5));

      for (const observation of [
        sample(0.375, 0.9),
        sample(0.5, 0.4),
        sample(0.625, 1.5),
        sample(0.75, 1.7),
        sample(1, 2),
      ]) {
        tested.update(observation);
        reference.update(observation);
        equivalent(tested, reference, observation.timeStamp, variant.name);
      }
    }
  }
});

test('a later timestamp recovers using the last raw sample after an unrepresentable bootstrap', () => {
  const tested = new KalmanPredictor();
  tested.update(sample(0, 0, 0));
  tested.update(sample(Number.MIN_VALUE, 1, 1));
  assert.equal(tested.predict(Number.MIN_VALUE, 10), null);
  tested.update(sample(1, 2, 3));
  assert.deepEqual(tested.predict(1, 1)?.points, [
    { x: 2, y: 3, offsetMs: 0 },
    { x: 3, y: 5, offsetMs: 1 },
  ]);

  const reference = new KalmanPredictor();
  reference.update(sample(Number.MIN_VALUE, 1, 1));
  reference.update(sample(1, 2, 3));

  for (const observation of [sample(2, 3, 5), sample(3, 4, 7)]) {
    tested.update(observation);
    reference.update(observation);
    equivalent(tested, reference, observation.timeStamp, 'raw recovery');
  }
});

test('repeated failed raw pairs recover once two consecutive raw samples are representable', () => {
  const model = new KalmanPredictor();
  model.update(sample(0, 0));
  model.update(sample(0.125, 1));
  model.update(sample(0.25, Number.MAX_VALUE));
  assert.equal(model.predict(0.25, 10), null);
  model.update(sample(0.375, 1.5));
  assert.equal(model.predict(0.375, 10), null);
  model.update(sample(0.5, 2));
  assert.deepEqual(model.predict(0.5, 10)?.points, [
    { x: 2, y: 0, offsetMs: 0 },
    { x: 42, y: 0, offsetMs: 10 },
  ]);
  model.update(sample(0.625, 2.5));
  assert.deepEqual(model.predict(0.625, 10)?.points, [
    { x: 2.5, y: 0, offsetMs: 0 },
    { x: 42.5, y: 0, offsetMs: 10 },
  ]);
});

test('expiry and explicit reset clear pending numerical failure metadata', () => {
  for (const explicitReset of [false, true]) {
    const tested = new KalmanPredictor();
    const reference = new KalmanPredictor();
    tested.update(sample(0, 0));
    tested.update(sample(0.125, 1));
    tested.update(sample(0.25, Number.MAX_VALUE));

    if (explicitReset) {
      tested.reset();
    }

    const start = explicitReset ? 0.25 : 100.25;
    tested.update(sample(start, 10));
    reference.update(sample(start, 10));
    assert.equal(tested.predict(start, 10), null);
    tested.update(sample(start + 0.25, 11));
    reference.update(sample(start + 0.25, 11));
    equivalent(tested, reference, start + 0.25, 'reset after failure');
  }
});

test('decimated measurements do not change the timestamp of the filtered position anchor', () => {
  for (const positionAnchor of ['filtered', 'measured']) {
    const model = new KalmanPredictor({}, { minimumAssimilationDtMs: 2, positionAnchor });
    model.update(sample(0, 0));
    model.update(sample(0.5, 100));
    model.update(sample(2, 2));
    model.update(sample(3, 300));
    model.update(sample(3, 333));
    const firstAnchor = positionAnchor === 'filtered' ? 3.5 : 333.5;
    assert.deepEqual(model.predict(3.5, 10)?.points, [
      { x: firstAnchor, y: 0, offsetMs: 0 },
      { x: firstAnchor + 10, y: 0, offsetMs: 10 },
    ]);
    model.update(sample(4, 4));
    model.update(sample(5, 500));
    const filteredAnchor = positionAnchor === 'filtered' ? 5.5 : 500.5;
    assert.deepEqual(model.predict(5.5, 10)?.points, [
      { x: filteredAnchor, y: 0, offsetMs: 0 },
      { x: filteredAnchor + 10, y: 0, offsetMs: 10 },
    ]);
  }
});
