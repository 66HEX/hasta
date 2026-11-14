import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { KalmanPredictor as CurrentPredictor } from '../../dist/core/prediction/kalman-predictor.js';
import { createCorpus, HORIZONS } from './corpus.mjs';
import { replayTrace, forecastMetrics, evaluateActions, aggregateActions } from './evaluate.mjs';
import { loadFilterControl } from './filter-controls.mjs';
import { resampleTrace, cadencePrecision } from './filter-resample.mjs';

const { values } = parseArgs({
  options: {
    candidate: { type: 'string' },
    control: { type: 'string', default: 'fa9ac8d' },
    output: { type: 'string', default: '/tmp/hasta-filter/cadence.json' },
    label: { type: 'string', default: 'current-production' },
    'seed-offset': { type: 'string', default: '240000000' },
    repeats: { type: 'string', default: '6' },
    cadences: { type: 'string', default: '1,2,4,6,7,8,9,10,16,20,33' },
  },
});

const candidatePath = values.candidate === undefined ? null : resolve(values.candidate);
const candidateModule = candidatePath === null ? null : await import(pathToFileURL(candidatePath));
const CandidatePredictor = candidateModule?.KalmanPredictor ?? CurrentPredictor;
const control = await loadFilterControl(values.control);
const sourceSha256 = {};

for (const path of [
  'filter-cadence.mjs',
  'filter-resample.mjs',
  'filter-controls.mjs',
  ...control.sourceFiles.map((file) => `../../${file}`),
  'filter-scenarios.mjs',
  'corpus.mjs',
  'evaluate.mjs',
  '../../dist/core/prediction/kalman-predictor.js',
  '../../dist/core/prediction/kalman-state.js',
]) {
  sourceSha256[path] = createHash('sha256')
    .update(await readFile(new URL(path, import.meta.url)))
    .digest('hex');
}

const cadences = values.cadences.split(',').map(Number);

if (cadences.some((value) => !Number.isFinite(value) || value <= 0)) {
  throw new Error('Cadences must be positive finite milliseconds.');
}

const profiles = ['clean', 'noisy', 'spikes', 'timed-spikes'];

const mean = (numbers) =>
  numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;

const base = createCorpus(
  'validation',
  Number(values.repeats),
  Number(values['seed-offset']),
).filter((trace) => trace.profile === 'clean');

const corpus = base.flatMap((trace) =>
  cadences.flatMap((cadence) =>
    [false, true].flatMap((jitter) =>
      profiles.map((profile) =>
        resampleTrace(trace, trace.position, cadence, jitter, profile, trace.seed),
      ),
    ),
  ),
);

const factories = {
  control: control.create,
  candidate: () => new CandidatePredictor(),
};

function summary(rows) {
  return {
    traces: rows.length,
    forecast: HORIZONS.map((horizonMs, index) => ({
      horizonMs,
      meanErrorPx: mean(rows.map((row) => row.forecast[index].meanTraceErrorPx)),
      meanTraceP95Px: mean(rows.map((row) => row.forecast[index].endpointErrorPx.p95)),
      postChangeMeanPx: mean(
        rows.flatMap((row) =>
          row.forecast[index].postChangeErrorPx.mean === null
            ? []
            : [row.forecast[index].postChangeErrorPx.mean],
        ),
      ),
      eligibleFrames: rows.reduce((sum, row) => sum + row.forecast[index].eligibleFrames, 0),
      forecastFrames: rows.reduce((sum, row) => sum + row.forecast[index].forecastFrames, 0),
    })),
    fixed: aggregateActions(rows.map((row) => row.action)),
  };
}

const models = {};

for (const [name, factory] of Object.entries(factories)) {
  const rows = corpus.map((trace) => {
    const replay = replayTrace(trace, name, factory);

    return {
      id: trace.id,
      family: trace.family,
      profile: trace.profile,
      cadence: trace.cadence,
      jitter: trace.jitter,
      forecast: forecastMetrics([replay]),
      action: evaluateActions(replay, { horizonMs: 120, stableForMs: 30, evidence: 'fresh' }),
    };
  });

  const grouped = (key) =>
    Object.fromEntries(
      [...Map.groupBy(rows, key)].map(([group, members]) => [group, summary(members)]),
    );

  models[name] = {
    total: summary(rows),
    byCadence: grouped((row) => `${row.cadence}/${row.jitter ? 'jitter' : 'regular'}`),
    byFamily: grouped((row) => row.family),
    byProfile: grouped((row) => row.profile),
    byCadenceProfile: grouped(
      (row) => `${row.cadence}/${row.jitter ? 'jitter' : 'regular'}/${row.profile}`,
    ),
    rows,
  };
}

const precision = cadencePrecision(factories, cadences);

const regressions = [];

for (const group of ['byCadence', 'byFamily', 'byProfile', 'byCadenceProfile']) {
  for (const [name, before] of Object.entries(models.control[group])) {
    const after = models.candidate[group][name];

    for (const [index, original] of before.forecast.entries()) {
      const updated = after.forecast[index];
      const limit = original.meanErrorPx + Math.max(2, original.meanErrorPx * 0.1);

      if (updated.meanErrorPx > limit || updated.forecastFrames !== original.forecastFrames) {
        regressions.push({
          group,
          name,
          horizonMs: original.horizonMs,
          before: original,
          after: updated,
        });
      }
    }
  }
}

const result = {
  protocol: {
    purpose:
      'Development-only cadence stress with fixed validation motion seeds; never final holdout evidence.',
    candidate: values.label,
    control: control.name,
    controlCommit: control.commit,
    cadences,
    jitter: 'uniform factor0.65–1.35 on each event interval',
    families: 'all eight stability families',
    profiles,
    disturbances:
      'spikes:2.5% per delivered moving sample; timed-spikes:first moving sample at/after cadence-independent fault times spaced80–240ms, sigma24px. Stationary silence does not invent events. Noise and motion are identical for control/candidate.',
    seedOffset: Number(values['seed-offset']),
    seedsPerFamily: Number(values.repeats),
    sourceSha256,
    candidateSha256:
      candidatePath === null
        ? null
        : createHash('sha256')
            .update(await readFile(candidatePath))
            .digest('hex'),
    tailMetric: 'Mean per-trace p95, not pooled frame p95.',
    responseTiming:
      'Response is measured from the first sampled positive displacement after each interpolated turn.32ms comparisons are reported as tradeoffs, not a new universal hard gate or API promise.',
    regressionGate:
      'No forecast availability change or family/profile/cadence mean harm above max10%,2px; preserve each baseline-supported precision episode within its original phase deadline, and no new wrong-lane start. Original unresampled contracts, main acceptance and browser tests remain mandatory.',
  },
  models,
  precision,
  acceptance: {
    passes: regressions.length === 0 && precision.every((row) => !row.regression),
    regressions,
    precisionRegressions: precision.filter((row) => row.regression),
  },
};

const output = resolve(values.output);

await mkdir(dirname(output), { recursive: true });

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });

console.log(
  JSON.stringify({
    output,
    passes: result.acceptance.passes,
    regressions: result.acceptance.regressions,
    precisionRegressions: result.acceptance.precisionRegressions,
    baselineValidPrecisionCases: precision.filter((row) => row.baselinePasses).length,
  }),
);
