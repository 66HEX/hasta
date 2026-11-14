import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { KalmanPredictor } from '../../dist/core/index.js';
import { KalmanPredictor as Baseline } from './baseline-d514639/core/prediction/kalman-predictor.js';
import { loadFilterControl } from './filter-controls.mjs';

const { values } = parseArgs({ options: { output: { type: 'string' } } });

if (!values.output) {
  throw new Error('Use --output with a new result file.');
}

const control = await loadFilterControl('d514639');
const Types = [Baseline, KalmanPredictor];
const framesPerBatch = 131072;
const warmup = 3;
const rounds = 9;
const reference = new Baseline();
let sink = 0;

const samples = Array.from({ length: 2048 }, (_, i) => ({
  x: i * 8 * 0.2 + Math.sin(i * 0.7) * 0.4,
  y: Math.sin(i / 50) * 15 + (i % 97 === 0 ? 24 : 0),
  timeStamp: i * 8,
}));

const frames = [];

for (let i = 0; i < samples.length; i += 2) {
  const pair = samples.slice(i, i + 2);

  for (const sample of pair) {
    reference.update(sample);
  }

  const now = pair[1].timeStamp;
  const [start, end] = reference.predict(now, 120).points;
  const middle = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

  const rects = Array.from({ length: 32 }, (_, target) => {
    const x = target % 2 === 0 ? middle.x : end.x + 100;
    const y = target % 2 === 0 ? middle.y : end.y + 100;
    const size = 10 + target / 4;

    return { minX: x - size, maxX: x + size, minY: y - size, maxY: y + size };
  });

  frames.push({ samples: pair, now, rects });
}

function measure(Model, targetCount) {
  const models = Array.from({ length: framesPerBatch / frames.length }, () => new Model());
  const start = performance.now();

  for (const model of models) {
    for (const frame of frames) {
      model.update(frame.samples[0]);
      model.update(frame.samples[1]);
      sink += model.predict(frame.now, 120).points[1].x;

      for (let i = 0; i < targetCount; i++) {
        sink += model.intersectRect(frame.now, 120, frame.rects[i])?.offsetMs ?? 0;
      }
    }
  }

  return ((performance.now() - start) * 1000) / framesPerBatch;
}

const median = (observations) =>
  observations.toSorted((a, b) => a - b)[Math.floor(observations.length / 2)];

const results = [];

for (const targetCount of [1, 4, 8, 32]) {
  const raw = [[], []];

  for (let round = 0; round < warmup + rounds; round++) {
    for (const which of round % 2 ? [1, 0] : [0, 1]) {
      const time = measure(Types[which], targetCount);

      if (round >= warmup) {
        raw[which].push(time);
      }
    }
  }

  const [beforeUs, afterUs] = raw.map((observations) => median(observations));
  const row = { targetCount, beforeUs, afterUs, improvement: 1 - afterUs / beforeUs, raw };
  results.push(row);
  console.log(JSON.stringify(row));
}

const fingerprints = {};

for (const file of [
  'src/core/prediction/kalman-predictor.ts',
  'src/core/prediction/kalman-state.ts',
  'dist/core/prediction/kalman-predictor.js',
  'dist/core/prediction/kalman-state.js',
  'benchmarks/stability/adaptive-frame-cpu.mjs',
]) {
  fingerprints[file] = createHash('sha256')
    .update(await readFile(new URL(`../../${file}`, import.meta.url)))
    .digest('hex');
}

await writeFile(
  values.output,
  `${JSON.stringify(
    {
      controlCommit: control.commit,
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      framesPerBatch,
      warmup,
      rounds,
      fingerprints,
      methodology:
        'Microseconds per synthetic core frame: two 8 ms pointer samples, one immutable prediction, then 1/4/8/32 target queries at the same time and horizon. Bounds and models are prepared outside timing. Includes input invalidation and projection reuse; excludes DOM, spatial indexing, subscriptions and rendering.',
      results,
      sinkFinite: Number.isFinite(sink),
    },
    null,
    2,
  )}\n`,
  { flag: 'wx' },
);
