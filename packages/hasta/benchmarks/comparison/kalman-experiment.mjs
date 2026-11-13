import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import {
  DEFAULT_ASSIMILATION_INTERVAL_MS,
  DEFAULT_POSITION_ANCHOR,
} from '../../dist/core/prediction/kalman-predictor.js';
import { DEFAULT_KALMAN_CONFIG } from '../../dist/core/prediction/kalman-state.js';
import { createCorpus, createTrace, TRAIN_FAMILIES, OOD_FAMILIES } from './corpus.mjs';
import { evaluateTrace, prepareTrace } from './evaluate.mjs';
import { aggregate, pairedInterval } from './statistics.mjs';

const { values } = parseArgs({
  options: {
    phase: { type: 'string', default: 'tune' },
    output: { type: 'string', default: '/tmp/hasta-kalman/results.json' },
  },
});

if (!['tune', 'evaluate'].includes(values.phase)) {
  throw new Error('phase must be tune or evaluate');
}

const output = resolve(values.output);
const directory = dirname(output);
const families = [...TRAIN_FAMILIES, ...OOD_FAMILIES];
const ratios = [1e-5, 1e-4, 4e-4, 1.6e-3, 6.4e-3, 2.56e-2, 0.1024, 0.4096, 1.6384];
const bases = { known: 0xb13579a1, motion: 0xc2468ac3, sensor: 0xd3579bd5, combined: 0xe468ace7 };
const oldBases = { known: 0x2468, motion: 0x3579, sensor: 0x468a, combined: 0x579b };
const mean = (numbers) => numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
const training = createCorpus('train', 5);

for (const family of ['straight', 'stop', 'turn', 'arc']) {
  for (const profile of ['quantized', 'outliers', 'correlated-fast']) {
    for (let repeat = 0; repeat < 3; repeat++) {
      training.push(
        createTrace(
          family,
          profile,
          0x318900 + families.indexOf(family) * 101 + repeat * 10007,
          'train',
        ),
      );
    }
  }
}

const descriptors = Object.entries(bases).flatMap(([split, base]) =>
  createCorpus(split, 5).map((trace) => ({
    family: trace.family,
    profile: trace.profile,
    split,
    seed:
      base +
      families.indexOf(trace.family) * 101 +
      Math.floor((trace.seed - oldBases[split]) / 10007) * 10007,
  })),
);

const oldSeeds = new Set(
  ['train', ...Object.keys(bases)].flatMap((split) =>
    createCorpus(split, 5).map((trace) => trace.seed),
  ),
);

for (const trace of training) {
  oldSeeds.add(trace.seed);
}

if (descriptors.some((trace) => oldSeeds.has(trace.seed))) {
  throw new Error('Final evaluation must use unseen seeds.');
}

const protocol = {
  baseCommit: '23e16ac',
  objective:
    '0.75 * macro endpoint error + 0.25 * macro endpoint error in the first 32 ms after a change. Invalid or missing eligible forecasts disqualify a configuration.',
  ratios,
  r: 0.25,
  assimilationIntervalsMs: [0, 1, 2],
  positionAnchors: ['filtered', 'measured'],
  trainingTraceIds: training.map((trace) => trace.id),
  testDescriptors: descriptors,
};

await mkdir(directory, { recursive: true });

const protocolPath = resolve(directory, 'protocol.json');
let previous = null;

try {
  previous = JSON.parse(await readFile(protocolPath, 'utf8'));
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}

if (previous !== null && JSON.stringify(previous) !== JSON.stringify(protocol)) {
  throw new Error('Protocol changed. Use a new output directory.');
}

await writeFile(protocolPath, `${JSON.stringify(protocol, null, 2)}\n`);

function score(corpus, config) {
  const overall = [];
  const transitions = [];

  for (const trace of corpus) {
    const row = evaluateTrace(trace, config, 1, false);

    if (
      row.invalidForecasts > 0 ||
      row.availableFrames !== row.eligibleFrames ||
      row.accuracy.some((metric) => metric.count === 0 || !Number.isFinite(metric.mean))
    ) {
      return { objective: Infinity, meanErrorPx: Infinity, first32MsErrorPx: Infinity };
    }

    overall.push(mean(row.accuracy.map((metric) => metric.mean)));
    const changed = row.postChange.filter((metric) => metric.count > 0);

    if (changed.length > 0) {
      transitions.push(mean(changed.map((metric) => metric.mean)));
    }
  }

  const meanErrorPx = mean(overall);
  const first32MsErrorPx = mean(transitions);

  return { objective: 0.75 * meanErrorPx + 0.25 * first32MsErrorPx, meanErrorPx, first32MsErrorPx };
}

async function tune() {
  const corpus = training.map((trace) => prepareTrace(trace, 0));
  const candidates = [];

  for (const positionAnchor of protocol.positionAnchors) {
    for (const minimumAssimilationDtMs of protocol.assimilationIntervalsMs) {
      for (const ratio of ratios) {
        const config = {
          kind: 'kalman-candidate',
          q: protocol.r * ratio,
          r: protocol.r,
          minimumAssimilationDtMs,
          positionAnchor,
        };

        const result = { config, ...score(corpus, config) };
        candidates.push(result);
        console.log(JSON.stringify(result));
      }
    }
  }

  const selected = candidates.toSorted((a, b) => a.objective - b.objective)[0];

  if (!selected || !Number.isFinite(selected.objective)) {
    throw new Error('No valid candidate.');
  }

  await writeFile(
    resolve(directory, 'tuning.json'),
    `${JSON.stringify({ protocol, candidates, selected }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ selected }));
}

async function evaluate() {
  const tuning = JSON.parse(await readFile(resolve(directory, 'tuning.json'), 'utf8'));

  if (JSON.stringify(tuning.protocol) !== JSON.stringify(protocol)) {
    throw new Error('Tuning and evaluation protocols differ.');
  }

  const productionConfig = {
    ...DEFAULT_KALMAN_CONFIG,
    minimumAssimilationDtMs: DEFAULT_ASSIMILATION_INTERVAL_MS,
    positionAnchor: DEFAULT_POSITION_ANCHOR,
  };

  for (const key of ['q', 'r', 'minimumAssimilationDtMs', 'positionAnchor']) {
    if (productionConfig[key] !== tuning.selected.config[key]) {
      throw new Error(`Build selected production defaults before evaluating: ${key}`);
    }
  }

  const corpus = descriptors.map((trace) =>
    prepareTrace(createTrace(trace.family, trace.profile, trace.seed, trace.split)),
  );

  const models = [
    { name: 'cv', config: { kind: 'cv' } },
    { name: 'regression', config: { kind: 'regression', windowMs: 16 } },
    { name: 'previous-kalman', config: { kind: 'kalman', q: 1e-4, r: 0.25 } },
    {
      name: 'untuned-kalman',
      config: {
        kind: 'kalman-candidate',
        q: 1e-4,
        r: 0.25,
        minimumAssimilationDtMs: 0,
        positionAnchor: 'filtered',
      },
    },
    { name: 'production', config: { kind: 'production' } },
  ];

  const rows = [];

  for (const model of models) {
    for (const trace of corpus) {
      rows.push({ model: model.name, ...evaluateTrace(trace, model.config, 1) });
    }

    console.log(`Evaluated ${model.name}`);
  }

  const results = models.map((model) => {
    const selected = rows.filter((row) => row.model === model.name);

    return {
      name: model.name,
      config: model.config,
      groups: Object.fromEntries(
        ['all', ...Object.keys(bases)].map((group) => {
          const matching = (row) => group === 'all' || row.split === group;
          const current = selected.filter((row) => matching(row));
          const baseline = rows.filter((row) => row.model === 'cv' && matching(row));

          return [
            group,
            { ...aggregate(current), meanErrorDifference95CI: pairedInterval(current, baseline) },
          ];
        }),
      ),
      byProfile: Object.fromEntries(
        [...Map.groupBy(selected, (row) => row.profile)].map(([profile, matching]) => [
          profile,
          aggregate(matching),
        ]),
      ),
    };
  });

  await writeFile(
    output,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), protocol, tuning, productionConfig, results, rows }, null, 2)}\n`,
  );
  console.log(`Saved ${output}`);
}

if (values.phase === 'tune') {
  await tune();
} else {
  await evaluate();
}
