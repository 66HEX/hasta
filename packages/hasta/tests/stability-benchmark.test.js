import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCorpus, createTrace } from '../benchmarks/stability/corpus.mjs';
import {
  replayTrace,
  evaluateActions,
  fitVarianceScale,
  forecastMetrics,
  selectPolicy,
} from '../benchmarks/stability/evaluate.mjs';
import { tracesFromSessions } from '../benchmarks/stability/lab.mjs';

const policy = {
  horizonMs: 120,
  stableForMs: 30,
  maxUncertaintyPx: null,
  evidence: 'fresh',
};

function silentTrace() {
  return {
    id: 'silent-stop',
    family: 'stop-short',
    profile: 'clean',
    selected: null,
    cutoff: 200,
    targets: [{ id: 'target', rect: { minX: 240, maxX: 260, minY: -10, maxY: 10 }, entryMs: null }],
    samples: Array.from({ length: 101 }, (_, timeStamp) => ({
      x: timeStamp,
      y: 0,
      timeStamp,
      arrivedAt: timeStamp,
      buttons: 0,
    })),
    frames: [100, 116, 132, 148, 164, 196, 200],
    resets: [],
    changeAt: 100,
    position: (time) => ({ x: Math.min(100, time), y: 0 }),
  };
}

test('frozen Kalman and subscription byte hashes preserve the prior implementation', async () => {
  const root = new URL('../benchmarks/stability/baseline-fa9ac8d/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
  assert.equal(manifest.baseCommit, 'fa9ac8da5ca593b2cc541eb0007f6d0d190aab06');

  for (const [path, digest] of Object.entries(manifest.sha256)) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(new URL(path, root)))
        .digest('hex'),
      digest,
      path,
    );
  }
});

test('internal experiment snapshots retain their captured byte hashes', async () => {
  const root = new URL('../benchmarks/stability/experimental/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));

  for (const [path, digest] of Object.entries(manifest.sha256)) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(new URL(path, root)))
        .digest('hex'),
      digest,
      path,
    );
  }
});

test('calibration, policy validation and test use disjoint complete motion blocks', () => {
  const seen = new Set();

  for (const split of ['calibration', 'validation', 'test']) {
    const traces = createCorpus(split, 2);
    const seeds = new Set(traces.map((trace) => trace.seed));

    for (const seed of seeds) {
      assert.equal(seen.has(seed), false);
      seen.add(seed);
    }

    for (const trace of traces) {
      assert.ok(trace.cutoff !== null && Number.isFinite(trace.cutoff));
      assert.ok(trace.samples.every((sample) => sample.arrivedAt >= sample.timeStamp));
      assert.ok(trace.targets.every((target) => target.rect.minX >= 0 && target.rect.minY >= 0));
      assert.equal(trace.split, split);
    }
  }
});

test('stationary periods produce silence and slow quantized movement has sparse changes', () => {
  const stop = createTrace('stop-short', 'clean', 501);
  const last = stop.samples.at(-1);
  assert.ok(last.timeStamp < stop.duration - 100);
  assert.deepEqual(stop.position(last.timeStamp + 100), stop.position(stop.duration));
  const slow = createTrace('quantized-slow', 'clean', 501);
  assert.ok(slow.samples.length < 40);
  assert.ok(
    slow.samples
      .slice(1)
      .some((sample, index) => sample.timeStamp - slow.samples[index].timeStamp >= 16),
  );
});

test('target registration order is independent of the chosen label and shared across measurement profiles', () => {
  const traces = createCorpus('calibration', 4);

  const chosenIndices = new Set(
    traces
      .filter((trace) => trace.selected !== null)
      .map((trace) => trace.targets.findIndex((target) => target.id === trace.selected)),
  );

  assert.deepEqual(chosenIndices, new Set([0, 1, 2]));
  const clean = createTrace('turn', 'clean', 104729);
  const noisy = createTrace('turn', 'outliers', 104729);
  assert.deepEqual(clean.targets, noisy.targets);
});

test('silence reproduces the frozen false callback but cannot corroborate a fresh-evidence action', () => {
  const trace = silentTrace();
  const before = evaluateActions(replayTrace(trace, 'frozen'), { ...policy, evidence: 'legacy' });
  const after = evaluateActions(replayTrace(trace, 'current'), policy);
  assert.equal(before.first.at, 164);
  assert.equal(before.wrong, 1);
  assert.equal(after.first, null);
  assert.equal(after.wrong, 0);
});

test('delayed samples cannot affect earlier predictions and stale delivery does not warm up', () => {
  const trace = silentTrace();
  trace.samples = [
    { x: 0, y: 0, timeStamp: 0, arrivedAt: 100, buttons: 0 },
    { x: 120, y: 0, timeStamp: 120, arrivedAt: 121, buttons: 0 },
    { x: 130, y: 0, timeStamp: 130, arrivedAt: 150, buttons: 0 },
  ];
  trace.frames = [100, 121, 149, 150];
  const replay = replayTrace(trace, 'current');
  assert.equal(replay.frames[0].evidenceTime, null);
  assert.equal(replay.frames[1].forecasts[120], null);
  assert.equal(replay.frames[2].forecasts[120], null);
  assert.notEqual(replay.frames[3].forecasts[120], null);
});

test('input reset prevents history and action stability from crossing epochs', () => {
  const trace = silentTrace();
  trace.resets = [{ at: 105 }];
  const replay = replayTrace(trace, 'current');
  assert.notEqual(replay.frames[0].forecasts[120], null);
  assert.equal(replay.frames[1].forecasts[120], null);
  assert.equal(replay.frames[1].evidenceTime, null);
});

test('an unavailable forecast consumes its pointer evidence before a later matching frame', () => {
  const trace = silentTrace();

  const hit = {
    target: { etaMs: 100, contact: false, crossed: false, candidate: true },
  };

  const frame = (now, evidenceTime, forecast) => ({
    now,
    evidenceTime,
    generation: 0,
    forecasts: { 120: forecast },
  });

  const replay = {
    trace,
    name: 'current',
    frames: [frame(10, 10, null), frame(20, 10, hit)],
  };

  assert.equal(evaluateActions(replay, { ...policy, stableForMs: 0 }).first, null);
  replay.frames.push(frame(30, 30, hit));
  assert.equal(evaluateActions(replay, { ...policy, stableForMs: 0 }).first.at, 30);
});

test('frame expiry resets history before a delayed measurement with a short timestamp gap arrives', () => {
  const trace = silentTrace();
  trace.samples = [
    { x: 0, y: 0, timeStamp: 0, arrivedAt: 0, buttons: 0 },
    { x: 10, y: 0, timeStamp: 10, arrivedAt: 10, buttons: 0 },
    { x: 100, y: 0, timeStamp: 100, arrivedAt: 120, buttons: 0 },
    { x: 130, y: 0, timeStamp: 130, arrivedAt: 130, buttons: 0 },
  ];
  trace.frames = [10, 110, 120, 130];
  const replay = replayTrace(trace, 'current');
  assert.notEqual(replay.frames[0].forecasts[120], null);
  assert.equal(replay.frames[1].evidenceTime, null);
  assert.equal(replay.frames[2].forecasts[120], null);
  assert.notEqual(replay.frames[3].forecasts[120], null);
});

test('clean sparse quantized motion remains forecastable after every fresh pair', () => {
  const trace = createTrace('quantized-slow', 'sparse', 104729);
  const replay = replayTrace(trace, 'current');
  const eligible = replay.frames.filter((frame) => frame.eligible);
  assert.ok(eligible.length > 10);
  assert.ok(
    eligible.every((frame) =>
      [16, 60, 120, 160].every((horizon) => frame.forecasts[horizon] !== null),
    ),
  );
});

test('variance fitting weights traces equally and coverage uses the frozen fitted scale', () => {
  const observation = (errorSquared) => ({
    horizon: 120,
    errorSquared,
    errorPx: Math.sqrt(errorSquared),
    variance: 1,
    postChange: false,
  });

  const training = [
    { errors: Array.from({ length: 100 }, () => observation(2)) },
    { errors: [observation(18)] },
  ];

  const scale = fitVarianceScale(training);
  assert.equal(scale, 5);
  const heldOut = [{ errors: [observation(25)] }];
  const metrics = forecastMetrics(heldOut, scale).find((metric) => metric.horizonMs === 120);
  assert.equal(metrics.coverage.find((coverage) => coverage.nominal === 0.9).observed, 0);
  assert.equal(metrics.coverage.find((coverage) => coverage.nominal === 0.95).observed, 1);
  assert.equal(scale, 5);
});

test('policy selection respects the validation false-action budget before maximizing useful coverage', () => {
  const candidates = [
    {
      policy: 'aggressive',
      metrics: { wrongPer100: 20, usefulCoverage: 1, leadMs: { median: 100 }, starts: 10 },
    },
    {
      policy: 'safe',
      metrics: { wrongPer100: 1, usefulCoverage: 0.8, leadMs: { median: 50 }, starts: 8 },
    },
    {
      policy: 'cautious',
      metrics: { wrongPer100: 0, usefulCoverage: 0.4, leadMs: { median: 40 }, starts: 4 },
    },
  ];

  assert.equal(selectPolicy(candidates, 2).policy, 'safe');
  assert.equal(selectPolicy(candidates, 0).policy, 'cautious');
  assert.equal(selectPolicy(candidates.slice(0, 1), 2), null);
});

test('lab adapter uses observed selected-target entry and preserves participant grouping and raw trials', () => {
  const trial = {
    id: 'trial',
    plan: { phase: 'main', mode: 'select' },
    quality: { eligible: true },
    outcome: 'selected',
    selected: 'goal',
    duration: 300,
    targets: [{ id: 'goal', rect: { minX: 10, minY: 10, maxX: 20, maxY: 20 } }],
    events: [{ type: 'enter', target: 'goal', at: 250 }],
    samples: [],
    ticks: [100, 200, 300],
    context: { attempt: 1 },
  };

  const session = {
    participant: 'P01',
    device: 'mouse',
    collection: { recordingId: 'recording', number: 2 },
    environment: {},
    trials: [trial],
  };

  const [trace] = tracesFromSessions([session]);
  assert.equal(trace.cutoff, 250);
  assert.equal(trace.block, 'P01');
  assert.equal(trace.sourceTrial, trial);
  assert.equal(trace.session, 2);
  assert.equal(trace.source, 'human');
  trial.events = [];
  assert.deepEqual(tracesFromSessions([session]), []);
});
