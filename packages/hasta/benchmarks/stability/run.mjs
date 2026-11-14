import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { createCorpus, FAMILIES, PROFILES, HORIZONS } from './corpus.mjs';
import {
  replayTrace,
  isExperimental,
  fitVarianceScale,
  forecastMetrics,
  evaluateActions,
  aggregateActions,
  selectPolicy,
} from './evaluate.mjs';

const { values } = parseArgs({
  options: {
    output: { type: 'string', default: '/tmp/hasta-stability/results.json' },
    phase: { type: 'string', default: 'all' },
    quick: { type: 'boolean', default: false },
    experiments: { type: 'boolean', default: false },
    repeats: { type: 'string', default: '4' },
    'seed-offset': { type: 'string', default: '0' },
  },
});

if (!['all', 'tune', 'evaluate'].includes(values.phase)) {
  throw new Error('phase must be all, tune or evaluate.');
}

const output = resolve(values.output);
const directory = dirname(output);
const tuningPath = resolve(directory, 'tuning.json');
const repeats = values.quick ? 1 : Number(values.repeats);
const seedOffset = Number(values['seed-offset']);

const models = values.experiments
  ? ['frozen', 'current', 'experimental-robust', 'experimental-adaptive']
  : ['frozen', 'current'];

const budgets = [0, 2, 5, 10];
const calibration = createCorpus('calibration', repeats, seedOffset);
const validation = createCorpus('validation', repeats, seedOffset);
const test = createCorpus('test', repeats, seedOffset);
const seenSeeds = new Set();

for (const corpus of [calibration, validation, test]) {
  for (const seed of new Set(corpus.map((trace) => trace.seed))) {
    if (seenSeeds.has(seed)) {
      throw new Error('Motion seeds overlap between calibration, validation and test.');
    }

    seenSeeds.add(seed);
  }
}

const sourceFiles = [
  'src/core/prediction/kalman-state.ts',
  'src/core/prediction/kalman-predictor.ts',
  'src/runtime/engine.ts',
  'src/runtime/triggers/subscription.ts',
  'dist/core/prediction/kalman-state.js',
  'dist/core/prediction/kalman-predictor.js',
  'dist/runtime/engine.js',
  'dist/runtime/triggers/subscription.js',
  'benchmarks/stability/corpus.mjs',
  'benchmarks/stability/evaluate.mjs',
  'benchmarks/stability/run.mjs',
  'benchmarks/stability/experimental/manifest.json',
];

const hashes = {};

for (const file of sourceFiles) {
  hashes[file] = createHash('sha256')
    .update(await readFile(new URL(`../../${file}`, import.meta.url)))
    .digest('hex');
}

const protocol = {
  version: 'stability-v2',
  purpose:
    'Synthetic motion and action policy evaluation; not an estimate of human accuracy or calibrated user intent.',
  repeats,
  seedOffset,
  horizonsMs: HORIZONS,
  models,
  budgets,
  splitIds: {
    calibration: calibration.map((trace) => trace.id),
    validation: validation.map((trace) => trace.id),
    test: test.map((trace) => trace.id),
  },
  sourceSha256: hashes,
  covarianceFit:
    'Only internal --experiments variants use covariance. Equal trace weight; mean squared 2D endpoint residual divided by twice predicted per-axis variance, fit only on calibration split.',
  policyFit:
    'Highest useful-action coverage then median lead time among policies within the validation wrong-first-action budget. Realized test error may exceed the validation budget.',
  labels:
    'First action before selected target first entry; none trials have no useful action. All starts/aborts/restarts reported separately.',
  actionScope:
    'Uses actual Subscription classes and predictor intersections on fixed visible targets; does not model DOM occlusion or moving bounds.',
};

await mkdir(directory, { recursive: true });

function policies(name) {
  const candidates = [60, 120, 160].flatMap((horizonMs) =>
    [0, 16, 30, 50].map((stableForMs) => ({
      horizonMs,
      stableForMs,
      evidence: name === 'frozen' ? 'legacy' : 'fresh',
    })),
  );

  if (!isExperimental(name)) {
    return candidates;
  }

  const uncertainty = [
    ...[null, 8, 16, 32, 64].map((maxUncertaintyPx) => ({
      maxUncertaintyPx,
      uncertaintyRatio: null,
    })),
    ...[0.25, 0.5, 1].map((uncertaintyRatio) => ({ maxUncertaintyPx: null, uncertaintyRatio })),
  ];

  return candidates.flatMap((policy) => uncertainty.map((gate) => Object.assign({}, policy, gate)));
}

async function tune() {
  const result = { protocol, models: {} };

  for (const name of models) {
    const training = isExperimental(name)
      ? calibration.map((trace) => replayTrace(trace, name))
      : [];

    const varianceScale = isExperimental(name) ? fitVarianceScale(training) : 1;
    const replay = validation.map((trace) => replayTrace(trace, name));

    const candidates = policies(name).map((policy) => ({
      policy,
      metrics: aggregateActions(
        replay.map((trace) => evaluateActions(trace, policy, varianceScale)),
      ),
    }));

    result.models[name] = {
      varianceScale,
      calibrationByHorizon: HORIZONS.map((horizonMs) => ({
        horizonMs,
        varianceScale: isExperimental(name) ? fitVarianceScale(training, horizonMs) : null,
      })),
      candidates,
      selected: budgets.map((budget) => ({ budget, selection: selectPolicy(candidates, budget) })),
    };
    console.log(
      JSON.stringify({
        phase: 'tune',
        model: name,
        varianceScale,
        selected: result.models[name].selected,
      }),
    );
  }

  await writeFile(tuningPath, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
}

function report(replay, policy, varianceScale) {
  if (policy === null) {
    const rows = replay.map(({ trace }) => ({
      id: trace.id,
      selected: trace.selected !== null,
      correct: 0,
      wrong: 0,
      abstained: 1,
      leadMs: null,
      actions: 0,
      wrongStarts: 0,
      aborts: 0,
      restarts: 0,
    }));

    return {
      policy: null,
      reason: 'No candidate met the validation budget; abstain from all actions.',
      metrics: aggregateActions(rows),
      rows,
    };
  }

  const rows = replay.map((trace) => evaluateActions(trace, policy, varianceScale));

  return {
    policy,
    metrics: aggregateActions(rows),
    byFamily: Object.fromEntries(
      FAMILIES.map((family) => [
        family,
        aggregateActions(rows.filter((row) => row.family === family)),
      ]),
    ),
    byProfile: Object.fromEntries(
      PROFILES.map((profile) => [
        profile,
        aggregateActions(rows.filter((row) => row.profile === profile)),
      ]),
    ),
    rows,
  };
}

async function evaluate() {
  const tuning = JSON.parse(await readFile(tuningPath, 'utf8'));

  if (JSON.stringify(tuning.protocol) !== JSON.stringify(protocol)) {
    throw new Error(
      'Source, corpus or protocol changed after tuning; use a fresh output directory.',
    );
  }

  const result = { protocol, node: process.version, quick: values.quick, models: {} };

  for (const name of models) {
    const replay = test.map((trace) => replayTrace(trace, name));
    const { varianceScale, selected } = tuning.models[name];

    const fixed = {
      horizonMs: 120,
      stableForMs: 30,
      evidence: name === 'frozen' ? 'legacy' : 'fresh',
    };

    result.models[name] = {
      varianceScale,
      forecast: forecastMetrics(replay),
      scaledForecast: forecastMetrics(replay, varianceScale),
      forecastByProfile: Object.fromEntries(
        PROFILES.map((profile) => [
          profile,
          forecastMetrics(
            replay.filter(({ trace }) => trace.profile === profile),
            varianceScale,
          ),
        ]),
      ),
      forecastByFamily: Object.fromEntries(
        FAMILIES.map((family) => [
          family,
          forecastMetrics(
            replay.filter(({ trace }) => trace.family === family),
            varianceScale,
          ),
        ]),
      ),
      fixed: report(replay, fixed, varianceScale),
      matchedBudgets: selected.map(({ budget, selection }) =>
        Object.assign({ budget }, report(replay, selection?.policy ?? null, varianceScale)),
      ),
    };
    console.log(
      JSON.stringify({
        phase: 'test',
        model: name,
        fixed: result.models[name].fixed.metrics,
        matchedBudgets: result.models[name].matchedBudgets.map(({ budget, metrics }) => ({
          budget,
          metrics,
        })),
      }),
    );
  }

  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
}

if (values.phase !== 'evaluate') {
  await tune();
}

if (values.phase !== 'tune') {
  await evaluate();
}
