import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { cpus, platform, arch } from 'node:os';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createCorpus, HORIZONS } from './corpus.mjs';
import { evaluateTrace, prepareTrace } from './evaluate.mjs';
import { pairedInterval, aggregate } from './statistics.mjs';

const { values } = parseArgs({
  options: {
    quick: { type: 'boolean', default: false },
    output: { type: 'string', default: '/tmp/hasta-comparison/results.json' },
    phase: { type: 'string', default: 'all' },
  },
});

const output = resolve(values.output);
const tuningPath = resolve(dirname(output), 'tuning.json');
const qValues = values.quick ? [1e-4, 1e-2] : [1e-6, 1e-4, 1e-2, 0.1];
const rValues = values.quick ? [0.25] : [0.01, 0.25, 4];
const trainingSeeds = values.quick ? 1 : 2;
const evaluationSeeds = values.quick ? 1 : 3;
const particleRepeats = values.quick ? 2 : 5;

await mkdir(dirname(output), { recursive: true });

const algorithmSeed = (repeat) => (0x51f7a29 + repeat * 0x9e3779b1) >>> 0;
const mean = (numbers) => numbers.reduce((total, value) => total + value, 0) / numbers.length;

const rowError = (row) =>
  mean(row.accuracy.filter((metric) => metric.mean !== null).map((metric) => metric.mean));

function score(corpus, config) {
  const repeats = config.kind === 'particle' ? 2 : 1;
  const scores = [];

  for (const trace of corpus) {
    for (let repeat = 0; repeat < repeats; repeat++) {
      const result = evaluateTrace(trace, config, algorithmSeed(repeat), false);
      scores.push(result.invalidForecasts > 0 ? Infinity : rowError(result));
    }
  }

  return mean(scores);
}

function candidates(kind, observation = 'gaussian') {
  if (kind === 'regression') {
    return [4, 8, 16, 32].map((windowMs) => ({ kind, windowMs }));
  }

  return qValues.flatMap((q) =>
    rValues.map((r) =>
      kind === 'kalman' ? { kind, q, r } : { kind, q, r, observation, particles: 256 },
    ),
  );
}

async function tune() {
  const corpus = createCorpus('train', trainingSeeds).map((trace) => prepareTrace(trace, 0));
  const tuning = [];
  const selected = [{ name: 'cv', config: { kind: 'cv' } }];

  for (const [kind, observation] of [
    ['regression', 'gaussian'],
    ['kalman', 'gaussian'],
    ['particle', 'gaussian'],
    ['particle', 'student-t'],
  ]) {
    let best = null;

    for (const config of candidates(kind, observation)) {
      const started = performance.now();
      const error = score(corpus, config);
      const result = { config, meanErrorPx: error, elapsedMs: performance.now() - started };
      tuning.push(result);
      console.log(JSON.stringify({ phase: 'tuning', ...result }));

      if (best === null || error < best.meanErrorPx) {
        best = result;
      }
    }

    selected.push({
      name: kind === 'particle' ? `particle-${observation}` : kind,
      config: best.config,
    });
  }

  const artifact = {
    quick: values.quick,
    trainingTraceIds: corpus.map((trace) => trace.id),
    objective:
      'Macro mean endpoint error across traces, horizons and particle repetitions; invalid forecasts disqualify a configuration.',
    tuning,
    selected,
  };

  await writeFile(tuningPath, `${JSON.stringify(artifact, null, 2)}\n`);

  return artifact;
}

function expandedModels(selected) {
  return selected.flatMap((model) => {
    if (model.config.kind !== 'particle') {
      return [model];
    }

    return (values.quick ? [64, 256] : [64, 256, 1024]).map((particles) => ({
      name: `${model.name}-${particles}`,
      config: { ...model.config, particles },
    }));
  });
}

async function evaluate(tuning) {
  const models = expandedModels(tuning.selected);

  const corpus = ['known', 'motion', 'sensor', 'combined'].flatMap((split) =>
    createCorpus(split, evaluationSeeds).map((trace) => prepareTrace(trace)),
  );

  const rows = [];

  for (const model of models) {
    const started = performance.now();
    const repeats = model.config.kind === 'particle' ? particleRepeats : 1;

    for (const trace of corpus) {
      for (let repeat = 0; repeat < repeats; repeat++) {
        rows.push({
          model: model.name,
          ...evaluateTrace(trace, model.config, algorithmSeed(repeat + 20)),
        });
      }
    }

    console.log(
      JSON.stringify({
        phase: 'evaluation',
        model: model.name,
        elapsedMs: performance.now() - started,
      }),
    );
    await writeFile(resolve(dirname(output), 'rows.partial.json'), `${JSON.stringify(rows)}\n`);
  }

  const groups = ['all', 'known', 'motion', 'sensor', 'combined'];

  const results = models.map((model) => {
    const selected = rows.filter((row) => row.model === model.name);

    return {
      ...model,
      groups: Object.fromEntries(
        groups.map((group) => {
          const matches = (row) => group === 'all' || row.split === group;
          const current = selected.filter((row) => matches(row));
          const baseline = rows.filter((row) => row.model === 'cv' && matches(row));

          return [
            group,
            { ...aggregate(current), meanErrorDifference95CI: pairedInterval(current, baseline) },
          ];
        }),
      ),
      byFamily: Object.fromEntries(
        [...Map.groupBy(selected, (row) => row.family)].map(([family, familyRows]) => [
          family,
          aggregate(familyRows),
        ]),
      ),
      byProfile: Object.fromEntries(
        [...Map.groupBy(selected, (row) => row.profile)].map(([sensor, sensorRows]) => [
          sensor,
          aggregate(sensorRows),
        ]),
      ),
    };
  });

  const artifact = {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: platform(),
      arch: arch(),
      cpu: cpus()[0]?.model,
    },
    quick: values.quick,
    horizonsMs: HORIZONS,
    oracleStepMs: 0.5,
    evaluationTraceIds: corpus.map((trace) => trace.id),
    particleRepeats,
    tuning,
    results,
    rows,
  };

  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(
    JSON.stringify({ phase: 'complete', output, models: models.length, traces: corpus.length }),
  );
}

if (!['all', 'tune', 'evaluate'].includes(values.phase)) {
  throw new Error('phase must be all, tune or evaluate');
}

const tuning =
  values.phase === 'evaluate' ? JSON.parse(await readFile(tuningPath, 'utf8')) : await tune();

if (tuning.quick !== values.quick) {
  throw new Error('Tuning and evaluation must use the same quick/full mode.');
}

if (values.phase !== 'tune') {
  await evaluate(tuning);
}
