import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCorpus,
  createTrace,
  HORIZONS,
  OOD_PROFILES,
  TRAIN_FAMILIES,
  TRAIN_PROFILES,
} from '../benchmarks/comparison/corpus.mjs';
import { evaluateTrace, prepareTrace } from '../benchmarks/comparison/evaluate.mjs';
import { firstSegmentRectIntersection } from '../dist/core/index.js';

function trace(samples, frames, position, targets = []) {
  return {
    id: 'test/custom/1',
    family: 'custom',
    profile: 'custom',
    seed: 1,
    split: 'test',
    samples,
    frames,
    position,
    targets,
    changeAt: 0,
    hasChange: false,
  };
}

function sample(timeStamp, x, arrivedAt = timeStamp) {
  return { x, y: 0, timeStamp, arrivedAt };
}

test('training and evaluation splits have disjoint motion seeds and unique trace identities', () => {
  const splits = ['train', 'known', 'motion', 'sensor', 'combined'];
  const corpora = splits.map((split) => createCorpus(split, 3));
  const previousSeeds = new Set();
  const identities = new Set();

  for (const [index, corpus] of corpora.entries()) {
    const seeds = new Set(corpus.map((item) => item.seed));
    assert.ok(seeds.size > 0);

    for (const seed of seeds) {
      assert.equal(previousSeeds.has(seed), false, `${splits[index]} reuses seed ${seed}`);
      previousSeeds.add(seed);
    }

    for (const item of corpus) {
      assert.equal(identities.has(item.id), false, `Duplicate trace ${item.id}`);
      identities.add(item.id);
      assert.equal(item.split, splits[index]);
    }
  }

  assert.deepEqual(new Set(corpora[1].map((item) => item.family)), new Set(TRAIN_FAMILIES));
  assert.ok(corpora[2].every((item) => !TRAIN_FAMILIES.includes(item.family)));
  assert.ok(corpora[3].every((item) => !TRAIN_PROFILES.includes(item.profile)));
});

test('sensor profiles preserve the same motion, target geometry and frame phase for a given seed', () => {
  for (const family of ['straight', 'turn', 'arc', 'figure-eight']) {
    const reference = createTrace(family, 'clean', 7919, 'test');

    for (const profile of [...TRAIN_PROFILES, ...OOD_PROFILES]) {
      const candidate = createTrace(family, profile, 7919, 'test');
      assert.equal(candidate.changeAt, reference.changeAt);
      assert.deepEqual(candidate.targets, reference.targets);
      assert.deepEqual(candidate.frames, reference.frames);

      for (const now of [0, 100, 500, reference.changeAt, 1000, 1500, 1620]) {
        assert.deepEqual(candidate.position(now), reference.position(now));
      }
    }
  }
});

test('a delayed measurement cannot improve the prediction before its delivery time', () => {
  const position = (time) => ({ x: time <= 10 ? time : 10 + 9 * (time - 10), y: 0 });
  const samples = [sample(0, 0), sample(10, 10), sample(20, 100, 40)];
  const before = evaluateTrace(prepareTrace(trace(samples, [30], position)), { kind: 'cv' }, 1);
  const after = evaluateTrace(prepareTrace(trace(samples, [40], position)), { kind: 'cv' }, 1);
  assert.equal(before.deliveredSamples, 2);
  assert.equal(after.deliveredSamples, 3);
  assert.deepEqual(
    before.accuracy.map((value) => value.mean),
    [288, 640, 1120],
  );
  assert.ok(after.accuracy.every((value) => value.count === 1 && value.mean === 0));
});

test('delivery requires two arrived samples and discards packets already stale on arrival', () => {
  const samples = [sample(0, 0, 100), sample(119, 119, 120), sample(120, 120, 121)];

  const evaluated = evaluateTrace(
    prepareTrace(trace(samples, [99, 100, 119, 120, 121], (time) => ({ x: time, y: 0 }))),
    { kind: 'cv' },
    1,
  );

  assert.equal(evaluated.deliveredSamples, 2);
  assert.equal(evaluated.totalFrames, 5);
  assert.equal(evaluated.eligibleFrames, 1);
  assert.equal(evaluated.availableFrames, 1);
  assert.ok(evaluated.accuracy.every((value) => value.count === 1 && value.mean === 0));
});

test('expiry breaks warmup and coverage counts include the frames lost during a dropout', () => {
  const samples = [sample(0, 0), sample(10, 10), sample(250, 250), sample(260, 260)];
  const frames = [10, 50, 110, 200, 250, 260, 270];

  const evaluated = evaluateTrace(
    prepareTrace(trace(samples, frames, (time) => ({ x: time, y: 0 }))),
    { kind: 'cv' },
    1,
  );

  assert.equal(evaluated.totalFrames, 7);
  assert.equal(evaluated.eligibleFrames, 4);
  assert.equal(evaluated.availableFrames, 4);
  assert.equal(evaluated.invalidForecasts, 0);
  assert.equal(evaluated.availableFrames / evaluated.eligibleFrames, 1);
  assert.ok(evaluated.availableFrames / evaluated.totalFrames < 0.6);
  assert.ok(evaluated.accuracy.every((value) => value.count === 4 && value.mean === 0));
});

test('the generated dropout profile loses input coverage without losing conditional availability', () => {
  const clean = evaluateTrace(
    prepareTrace(createTrace('straight', 'clean', 53, 'test')),
    { kind: 'cv' },
    1,
  );

  const dropout = evaluateTrace(
    prepareTrace(createTrace('straight', 'dropout', 53, 'test')),
    { kind: 'cv' },
    1,
  );

  assert.equal(dropout.totalFrames, clean.totalFrames);
  assert.ok(dropout.eligibleFrames < clean.eligibleFrames);
  assert.ok(dropout.eligibleFrames / dropout.totalFrames < 0.9);
  assert.equal(dropout.availableFrames, dropout.eligibleFrames);
});

test('the future-contact oracle detects a turn that its start-to-end chord misses', () => {
  const position = (time) => ({ x: Math.min(time, 60), y: Math.max(0, time - 60) });
  const rect = { minX: 55, maxX: 65, minY: -1, maxY: 1 };
  assert.equal(firstSegmentRectIntersection(position(0), position(120), rect), null);
  const prepared = prepareTrace(trace([], [0, 20], position, [rect]));
  assert.equal(prepared.frames[0].hits[0], 55);
  assert.equal(prepared.frames[1].hits[0], 35);
  assert.deepEqual(
    prepared.frames[0].expected,
    HORIZONS.map((horizon) => position(horizon)),
  );
});

test('current contact is excluded from predictive classification and ETA metrics', () => {
  const targets = [
    { minX: 0, maxX: 100, minY: -1, maxY: 1 },
    { minX: 500, maxX: 510, minY: -1, maxY: 1 },
  ];

  const evaluated = evaluateTrace(
    prepareTrace(
      trace(
        [sample(0, 0), sample(10, 10), sample(20, 20)],
        [10, 20],
        (time) => ({ x: time, y: 0 }),
        targets,
      ),
    ),
    { kind: 'cv' },
    1,
  );

  assert.deepEqual(
    evaluated.confusion,
    HORIZONS.map(() => ({ tp: 0, fp: 0, fn: 0, tn: 2 })),
  );
  assert.equal(evaluated.etaError.count, 0);
  assert.equal(evaluated.arrivalJitter.count, 0);
  assert.equal(evaluated.predictionFlips, 0);
  assert.equal(evaluated.truthFlips, 0);
  assert.ok(evaluated.accuracy.every((value) => value.count === 2));
});

test('no input produces missing accuracy metrics instead of a perfect zero-error result', () => {
  const evaluated = evaluateTrace(
    prepareTrace(trace([], [0, 10], (time) => ({ x: time, y: 0 }))),
    { kind: 'cv' },
    1,
  );

  assert.equal(evaluated.totalFrames, 2);
  assert.equal(evaluated.eligibleFrames, 0);
  assert.equal(evaluated.availableFrames, 0);
  assert.ok(
    evaluated.accuracy.every(
      (value) => value.count === 0 && value.mean === null && value.rmse === null,
    ),
  );
});

test('halving the oracle time step preserves classifications and changes curved-path ETAs by less than 0.002ms', () => {
  let comparisons = 0;
  let contacts = 0;
  let largestEtaChange = 0;

  for (const family of ['arc', 'figure-eight', 'overshoot', 'minimum-jerk']) {
    for (const seed of [11, 37, 91]) {
      const input = createTrace(family, 'clean', seed, 'sensitivity');
      const coarse = prepareTrace(input, 0.5);
      const fine = prepareTrace(input, 0.25);

      for (const [frameIndex, frame] of coarse.frames.entries()) {
        assert.deepEqual(frame.expected, fine.frames[frameIndex].expected);

        for (const [targetIndex, eta] of frame.hits.entries()) {
          const reference = fine.frames[frameIndex].hits[targetIndex];
          comparisons++;
          assert.equal(
            eta === null,
            reference === null,
            `${family}/${seed}/${frameIndex}/${targetIndex}`,
          );

          if (eta !== null) {
            contacts++;
            largestEtaChange = Math.max(largestEtaChange, Math.abs(eta - reference));
          }
        }
      }

      const a = evaluateTrace(coarse, { kind: 'cv' }, 1);
      const b = evaluateTrace(fine, { kind: 'cv' }, 1);
      assert.deepEqual(a.accuracy, b.accuracy);
      assert.deepEqual(a.confusion, b.confusion);
      assert.equal(a.etaError.count, b.etaError.count);
      assert.ok(Math.abs(a.etaError.mean - b.etaError.mean) < 0.002);
    }
  }

  assert.ok(comparisons >= 6000);
  assert.ok(contacts >= 1000);
  assert.ok(largestEtaChange < 0.002, `Largest ETA change: ${largestEtaChange}ms`);
});
