import assert from 'node:assert/strict';
import test from 'node:test';

import { createCorpus } from '../benchmarks/stability/corpus.mjs';
import { replayTrace } from '../benchmarks/stability/evaluate.mjs';
import { loadFilterControl } from '../benchmarks/stability/filter-controls.mjs';
import { balancedCorpus } from '../benchmarks/stability/filter-resample.mjs';
import { compactReplay, motionSeeds } from '../benchmarks/stability/filter-study.mjs';
import {
  iteration3Stage,
  recordingFactory,
  paritySummary,
  assessIteration3,
} from '../benchmarks/stability/iteration3-study.mjs';

test('iteration3 control is the accepted sparse-input filter and keeps historical defaults', async () => {
  const current = await loadFilterControl('5cf01cf');
  assert.equal(current.commit, '5cf01cf9cd97dd2603a22143fbebaac95343da5d');
  assert.equal((await loadFilterControl()).name, 'fa9ac8d');
  assert.equal((await loadFilterControl('0a503bb')).name, '0a503bb');
});

test('canonical parity digest is stable across repeated numeric representations', async () => {
  const control = await loadFilterControl('5cf01cf');
  const trace = createCorpus('calibration', 1, 1560000000)[0];
  let expected;

  for (let iteration = 0; iteration < 4; iteration++) {
    const recorder = recordingFactory(control.create);
    const replay = compactReplay(replayTrace(trace, 'candidate', recorder.create));
    const recorded = recorder.finish(replay.action, replay.immediate);

    if (expected === undefined) {
      expected = recorded;
    } else {
      assert.deepEqual(recorded, expected);
    }
  }
});

test('query digest preserves signed zero and detects subnormal changes', () => {
  const digest = (x) => {
    const recorder = recordingFactory(() => ({
      predict: () => ({ x }),
      intersectRect: () => null,
    }));

    recorder.create().predict(1, 120);

    return recorder.finish({}, {});
  };

  const positive = digest(0);
  const negative = digest(-0);
  const subnormal = digest(Number.MIN_VALUE);
  assert.notEqual(positive.querySha256, negative.querySha256);
  assert.notEqual(positive.querySha256, subnormal.querySha256);
  assert.equal(positive.availabilitySha256, negative.availabilitySha256);
});

test('action digest detects a changed episode independently of equal forecasts', () => {
  const one = recordingFactory(() => ({}));
  const two = recordingFactory(() => ({}));
  const before = one.finish({ episodes: [{ at: 10 }] }, {});
  const after = two.finish({ episodes: [{ at: 11 }] }, {});
  const report = paritySummary([{ id: 'one', control: before, candidate: after }]);
  assert.deepEqual(report.queryMismatches, []);
  assert.deepEqual(report.actionMismatches, ['one']);
});

test('iteration3 seed metadata is disjoint from every previous reserved offset without generating final data', () => {
  const seen = new Set();

  for (const name of ['training', 'development', 'cadence', 'final']) {
    for (const seed of iteration3Stage(name).motionSeeds) {
      assert.equal(seen.has(seed), false);
      seen.add(seed);
    }
  }

  for (const offset of [
    0, 70000000, 110000000, 150000000, 190000000, 240000000, 480000000, 720000000, 960000000,
    1080000000, 1440000000,
  ]) {
    for (const split of ['calibration', 'validation', 'test']) {
      assert.ok(motionSeeds(split, 12, offset).every((seed) => !seen.has(seed)));
    }
  }

  assert.throws(() => iteration3Stage('final', 3));
});

test('CPU parity can pass independently of action gains while a changed query cannot', async () => {
  const control = await loadFilterControl('5cf01cf');

  const replays = [...balancedCorpus('calibration', 1, 1560000000, [1000 / 120])].map((trace) =>
    compactReplay(replayTrace(trace, 'control', control.create)),
  );

  const parity = { queryMismatches: [], actionMismatches: [], availabilityMismatches: [] };
  const cpu = assessIteration3(replays, replays, replays, 'cpu', parity);
  assert.equal(cpu.acceptance.passes, true);
  assert.equal(cpu.retainedGains.overallImprovement, 0);
  assert.equal(cpu.retainedGains.requiredForAcceptance, false);
  assert.equal(
    assessIteration3(replays, replays, replays, 'cpu', { ...parity, queryMismatches: ['changed'] })
      .acceptance.passes,
    false,
  );
  assert.equal(
    assessIteration3(replays, replays, replays, 'actions', parity).acceptance.passes,
    false,
  );
});
