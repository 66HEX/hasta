import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { KalmanPredictor } from '../../dist/core/index.js';
import { loadFilterControl } from './filter-controls.mjs';

const { values } = parseArgs({ options: { output: { type: 'string' } } });

if (!values.output) {
  throw new Error('Use --output with a new result file.');
}

const control = await loadFilterControl('d514639');
const baseline = await import('./baseline-d514639/core/prediction/kalman-predictor.js');
const Types = [baseline.KalmanPredictor, KalmanPredictor];
const calls = 1024 * 1024;
const warmup = 3;
const rounds = 9;
const operations = ['update', 'predict', 'intersect', 'intersect-batch'];
let sink = 0;

function measure(Model, samples, operation) {
  if (operation === 'update') {
    const models = Array.from({ length: calls / samples.length }, () => new Model());
    const start = performance.now();

    for (const model of models) {
      for (const sample of samples) {
        model.update(sample);
      }
    }

    const elapsed = performance.now() - start;

    for (const model of models) {
      sink += model.predict(samples.at(-1).timeStamp, 120).points[1].x;
    }

    return (elapsed * 1000) / calls;
  }

  const model = new Model();

  for (const sample of samples) {
    model.update(sample);
  }

  const now = samples.at(-1).timeStamp;
  const [startPoint, end] = model.predict(now, 120).points;
  const middle = { x: (startPoint.x + end.x) / 2, y: (startPoint.y + end.y) / 2 };

  const rects = [
    { minX: middle.x - 10, maxX: middle.x + 10, minY: middle.y - 10, maxY: middle.y + 10 },
    { minX: end.x + 100, maxX: end.x + 110, minY: end.y + 100, maxY: end.y + 110 },
  ];

  const start = performance.now();

  if (operation === 'predict') {
    for (let i = 0; i < calls; i++) {
      sink += model.predict(now + (i % 4), 120).points[1].x;
    }
  } else {
    for (let i = 0; i < calls; i++) {
      const age = operation === 'intersect-batch' ? Math.floor(i / 8) % 4 : i % 4;
      sink += model.intersectRect(now + age, 120, rects[i % 2])?.offsetMs ?? 0;
    }
  }

  return ((performance.now() - start) * 1000) / calls;
}

const median = (observations) =>
  observations.toSorted((a, b) => a - b)[Math.floor(observations.length / 2)];

function interval(before, after) {
  let seed = 71093;
  const ratios = [];

  for (let i = 0; i < 2000; i++) {
    const a = [],
      b = [];

    for (let j = 0; j < rounds; j++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const index = seed % rounds;
      a.push(before[index]);
      b.push(after[index]);
    }

    ratios.push(median(b) / median(a));
  }

  ratios.sort((a, b) => a - b);

  return [ratios[50], ratios[1949]];
}

function measureCase(samples) {
  const raw = operations.map(() => [[], []]);

  for (let round = 0; round < warmup + rounds; round++) {
    for (const which of round % 2 ? [1, 0] : [0, 1]) {
      for (const [index, operation] of operations.entries()) {
        const time = measure(Types[which], samples, operation);

        if (round >= warmup) {
          raw[index][which].push(time);
        }
      }
    }
  }

  return raw;
}

const fingerprints = {};

for (const file of [
  'src/core/prediction/kalman-predictor.ts',
  'src/core/prediction/kalman-state.ts',
  'dist/core/prediction/kalman-predictor.js',
  'dist/core/prediction/kalman-state.js',
  'benchmarks/stability/adaptive-cpu.mjs',
]) {
  fingerprints[file] = createHash('sha256')
    .update(await readFile(new URL(`../../${file}`, import.meta.url)))
    .digest('hex');
}

const results = [];

for (const dt of [1, 4, 8, 1000 / 60, 33]) {
  const profiles = [1, 8, 1000 / 60].includes(dt)
    ? ['clean', 'spike', 'correction']
    : ['clean', 'spike'];

  for (const profile of profiles) {
    const samples = Array.from({ length: 2048 }, (_, i) => {
      const step = profile === 'correction' ? Math.floor(i / 2) : i;

      return {
        x:
          step * dt * 0.2 +
          Math.sin(step * 0.7) * 0.4 +
          (profile === 'correction' ? (i % 2) * 0.125 : 0),
        y: Math.sin(step / 50) * 15 + (profile === 'spike' && i % 97 === 0 ? 24 : 0),
        timeStamp: step * dt,
      };
    });

    const raw = measureCase(samples);

    for (const [index, operation] of operations.entries()) {
      const [before, after] = raw[index];

      const beforeUs = median(before),
        afterUs = median(after);

      results.push({
        dt,
        profile,
        operation,
        beforeUs,
        afterUs,
        improvement: 1 - afterUs / beforeUs,
        ratioInterval95: interval(before, after),
        before,
        after,
      });
    }

    console.log(JSON.stringify({ dt, profile, completed: true }));
  }
}

function measureConstruction(Model) {
  const models = Array.from({ length: 16384 });
  const start = performance.now();

  for (let batch = 0; batch < calls / models.length; batch++) {
    for (let index = 0; index < models.length; index++) {
      models[index] = new Model();
    }
  }

  const elapsed = performance.now() - start;

  for (const model of models) {
    sink += model.predict(0, 120) === null ? 1 : 0;
  }

  return (elapsed * 1000) / calls;
}

const creationTimes = [[], []];

for (let round = 0; round < warmup + rounds; round++) {
  for (const which of round % 2 ? [1, 0] : [0, 1]) {
    const time = measureConstruction(Types[which]);

    if (round >= warmup) {
      creationTimes[which].push(time);
    }
  }
}

const [creationBefore, creationAfter] = creationTimes;

results.push({
  dt: null,
  profile: 'new-model',
  operation: 'construct',
  beforeUs: median(creationBefore),
  afterUs: median(creationAfter),
  improvement: 1 - median(creationAfter) / median(creationBefore),
  ratioInterval95: interval(creationBefore, creationAfter),
  before: creationBefore,
  after: creationAfter,
});

const primary = results.filter(
  (row) => row.operation === 'intersect-batch' && row.dt === 8 && row.profile !== 'correction',
);

const report = {
  controlCommit: control.commit,
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  callsPerBatch: calls,
  warmup,
  rounds,
  fingerprints,
  methodology:
    'Microseconds per call from batch means. Rotating model order, paired bootstrap intervals. Includes immutable outputs; model construction is measured separately. Batched intersections share a frame timestamp across 8 queries, with one projection miss per batch. Synthetic CPU measurements, not browser latency.',
  primaryTarget:
    '8 target queries per frame after 125 Hz input: at least 10% less CPU per query for clean and outlier streams.',
  primaryPasses: primary.every((row) => row.improvement >= 0.1 && row.ratioInterval95[1] < 1),
  regressions: results.filter((row) => row.ratioInterval95[0] > 1 && row.afterUs > row.beforeUs),
  results,
  sinkFinite: Number.isFinite(sink),
};

await writeFile(values.output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });

console.log(
  JSON.stringify({
    primaryPasses: report.primaryPasses,
    regressions: report.regressions.map(({ dt, profile, operation, improvement }) => ({
      dt,
      profile,
      operation,
      improvement,
    })),
  }),
);
