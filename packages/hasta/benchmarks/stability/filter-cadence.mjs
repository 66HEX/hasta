import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { KalmanPredictor as CurrentPredictor } from '../../dist/core/prediction/kalman-predictor.js';
import { randomSource } from '../comparison/corpus.mjs';
import { KalmanPredictor as ControlPredictor } from './baseline-fa9ac8d/core/prediction/kalman-predictor.js';
import { createCorpus, HORIZONS } from './corpus.mjs';
import { replayTrace, forecastMetrics, evaluateActions, aggregateActions } from './evaluate.mjs';
import { precisionTraces, precisionReport } from './filter-scenarios.mjs';

const { values } = parseArgs({
  options: {
    candidate: { type: 'string' },
    output: { type: 'string', default: '/tmp/hasta-filter/cadence.json' },
    label: { type: 'string', default: 'current-production' },
  },
});

const candidatePath = values.candidate === undefined ? null : resolve(values.candidate);
const candidateModule = candidatePath === null ? null : await import(pathToFileURL(candidatePath));
const CandidatePredictor = candidateModule?.KalmanPredictor ?? CurrentPredictor;
const sourceSha256 = {};

for (const path of [
  'filter-cadence.mjs',
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

const cadences = [1, 2, 4, 6, 7, 8, 9, 10, 16, 20, 33];
const profiles = ['clean', 'noisy', 'spikes', 'timed-spikes'];

const mean = (numbers) =>
  numbers.length === 0 ? null : numbers.reduce((sum, value) => sum + value, 0) / numbers.length;

function resample(source, position, cadence, jitter, profile, seed) {
  const random = randomSource(seed ^ 0x4ad563b1);
  const clock = randomSource(seed ^ 0x7a2e48d9);
  const faults = randomSource(seed ^ 0x137e9ba2);
  const samples = [];
  let previous = null;
  let nextFault = source.samples[0].timeStamp + 80 + 160 * faults.uniform();

  for (
    let time = source.samples[0].timeStamp;
    time <= source.frames.at(-1);
    time += cadence * (jitter ? 0.65 + 0.7 * clock.uniform() : 1)
  ) {
    const point = position(time);
    let faultX = 0;
    let faultY = 0;

    while (nextFault <= time) {
      faultX = faults.normal() * 24;
      faultY = faults.normal() * 24;
      nextFault += 80 + 160 * faults.uniform();
    }

    const truth =
      source.family === 'quantized-slow'
        ? { x: Math.round(point.x), y: Math.round(point.y) }
        : point;

    if (previous !== null && truth.x === previous.x && truth.y === previous.y) {
      continue;
    }

    previous = truth;
    const spike = profile === 'spikes' && random.uniform() < 0.025;
    const noise = profile === 'clean' ? 0 : 0.35;

    samples.push({
      x:
        truth.x +
        noise * random.normal() +
        (spike ? 24 * random.normal() : 0) +
        (profile === 'timed-spikes' ? faultX : 0),
      y:
        truth.y +
        noise * random.normal() +
        (spike ? 24 * random.normal() : 0) +
        (profile === 'timed-spikes' ? faultY : 0),
      timeStamp: time,
      arrivedAt: time,
      buttons: 0,
    });
  }

  return {
    ...source,
    id: `${source.id}/${cadence}/${jitter}/${profile}`,
    profile,
    cadence,
    jitter,
    samples,
  };
}

const base = createCorpus('validation', 6, 240000000).filter((trace) => trace.profile === 'clean');

const corpus = base.flatMap((trace) =>
  cadences.flatMap((cadence) =>
    [false, true].flatMap((jitter) =>
      profiles.map((profile) =>
        resample(trace, trace.position, cadence, jitter, profile, trace.seed),
      ),
    ),
  ),
);

const factories = {
  control: () => new ControlPredictor(),
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

const precision = [];

for (const cadence of cadences) {
  for (const jitter of [false, true]) {
    const traces = precisionTraces()
      .filter((trace) => trace.profile === 'direct')
      .map((trace) => {
        const position = (time) => {
          const after = trace.samples.findIndex((sample) => sample.timeStamp >= time);

          if (after <= 0) {
            return after === 0 ? trace.samples[0] : trace.samples.at(-1);
          }

          const previous = trace.samples[after - 1];
          const next = trace.samples[after];
          const fraction = (time - previous.timeStamp) / (next.timeStamp - previous.timeStamp);

          return {
            x: previous.x + fraction * (next.x - previous.x),
            y: previous.y + fraction * (next.y - previous.y),
          };
        };

        const sampled = resample(trace, position, cadence, jitter, 'clean', 75431);

        sampled.id = trace.id;

        return sampled;
      });

    const control = precisionReport(factories.control, traces);
    const candidate = precisionReport(factories.candidate, traces);

    for (const [index, before] of control.scenarios.entries()) {
      const after = candidate.scenarios[index];

      const phases =
        before.id === 'narrow-channel'
          ? [
              ['initial-right', 'right', 1000, 1030],
              ['down', 'down', 1030, 1062],
              ['reapproach', 'right', 1070, 1112],
            ]
          : [
              ['initial', 'target', 1000, 1040],
              ['reapproach', 'target', 1050, 1060],
            ];

      const phasesCompared = phases.map(([phase, target, from, until]) => {
        const match = (episodes) =>
          episodes.find(
            (episode) => episode.target === target && episode.at >= from && episode.at <= until,
          );

        const original = match(before.episodes);
        const updated = match(after.episodes);

        const turnAt =
          phase === 'down'
            ? 1020
            : phase === 'reapproach'
              ? before.id === 'narrow-channel'
                ? 1070
                : 1050
              : null;

        const axis = phase === 'down' ? 'y' : 'x';

        const observedTurn =
          turnAt === null
            ? undefined
            : traces[index].samples.find(
                (sample, sampleIndex, samples) =>
                  sampleIndex > 0 &&
                  sample.timeStamp > turnAt &&
                  sample[axis] > samples[sampleIndex - 1][axis],
              );

        return {
          phase,
          target,
          deadline: until,
          baselineAt: original?.at ?? null,
          candidateAt: updated?.at ?? null,
          firstObservedTurnAt: observedTurn?.timeStamp ?? null,
          baselineResponseMs:
            observedTurn === undefined || original === undefined
              ? null
              : original.at - observedTurn.timeStamp,
          candidateResponseMs:
            observedTurn === undefined || updated === undefined
              ? null
              : updated.at - observedTurn.timeStamp,
          regression: original !== undefined && updated === undefined,
        };
      });

      const wrongLaneRegression =
        !before.episodes.some((episode) => episode.target === 'diagonal') &&
        after.episodes.some((episode) => episode.target === 'diagonal');

      precision.push({
        cadence,
        jitter,
        id: before.id,
        baselinePasses: before.passes,
        candidatePasses: after.passes,
        regression: wrongLaneRegression || phasesCompared.some((phase) => phase.regression),
        phases: phasesCompared,
        wrongLaneRegression,
        control: before.episodes,
        candidate: after.episodes,
      });
    }
  }
}

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
    cadences,
    jitter: 'uniform factor0.65–1.35 on each event interval',
    families: 'all eight stability families',
    profiles,
    disturbances:
      'spikes:2.5% per delivered moving sample; timed-spikes:first moving sample at/after cadence-independent fault times spaced80–240ms, sigma24px. Stationary silence does not invent events. Noise and motion are identical for control/candidate.',
    seedOffset: 240000000,
    seedsPerFamily: 6,
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
