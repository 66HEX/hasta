import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { KalmanPredictor as CurrentPredictor } from '../../dist/core/prediction/kalman-predictor.js';
import { createCorpus } from '../comparison/corpus.mjs';
import { prepareTrace, evaluateTrace } from '../comparison/evaluate.mjs';
import { aggregate, pairedInterval } from '../comparison/statistics.mjs';
import { loadFilterControl } from './filter-controls.mjs';

const { values } = parseArgs({
  options: {
    output: { type: 'string', default: '/tmp/hasta-filter/external.json' },
    candidate: { type: 'string' },
    control: { type: 'string', default: 'fa9ac8d' },
    label: { type: 'string', default: 'current-production' },
  },
});

const candidatePath = values.candidate === undefined ? null : resolve(values.candidate);
const candidateModule = candidatePath === null ? null : await import(pathToFileURL(candidatePath));
const CandidatePredictor = candidateModule?.KalmanPredictor ?? CurrentPredictor;
const control = await loadFilterControl(values.control);
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceSha256 = {};

const sourceFiles = [
  'benchmarks/comparison/corpus.mjs',
  'benchmarks/comparison/evaluate.mjs',
  'benchmarks/comparison/statistics.mjs',
  'benchmarks/stability/filter-external.mjs',
  'benchmarks/stability/filter-controls.mjs',
  ...control.sourceFiles,
  'dist/core/prediction/kalman-state.js',
  'dist/core/prediction/kalman-predictor.js',
];

if (candidatePath !== null) {
  for (const path of await readdir(dirname(candidatePath), { recursive: true })) {
    if (/\.(?:mjs|js|json)$/u.test(path)) {
      sourceFiles.push(relative(packageRoot, resolve(dirname(candidatePath), path)));
    }
  }
}

for (const path of sourceFiles) {
  sourceSha256[path] = createHash('sha256')
    .update(await readFile(resolve(packageRoot, path)))
    .digest('hex');
}

const corpus = ['known', 'motion', 'sensor', 'combined'].flatMap((split) =>
  createCorpus(split, 3).map((trace) => prepareTrace(trace, 0)),
);

const factories = {
  control: control.create,
  candidate: () => new CandidatePredictor(),
};

const rows = Object.fromEntries(
  Object.entries(factories).map(([name, factory]) => [
    name,
    corpus.map((trace) => evaluateTrace(trace, {}, 0, false, factory)),
  ]),
);

const reports = Object.fromEntries(
  Object.entries(rows).map(([name, entries]) => [
    name,
    {
      total: aggregate(entries),
      byFamily: Object.fromEntries(
        [...Map.groupBy(entries, (row) => row.family)].map(([key, group]) => [
          key,
          aggregate(group),
        ]),
      ),
      byProfile: Object.fromEntries(
        [...Map.groupBy(entries, (row) => row.profile)].map(([key, group]) => [
          key,
          aggregate(group),
        ]),
      ),
      bySplit: Object.fromEntries(
        [...Map.groupBy(entries, (row) => row.split)].map(([key, group]) => [
          key,
          aggregate(group),
        ]),
      ),
    },
  ]),
);

const checks = [];

const check = (name, actual, limit) =>
  checks.push({ name, actual, limit, passes: actual <= limit });

check(
  'no additional invalid forecasts',
  reports.candidate.total.invalidForecasts,
  reports.control.total.invalidForecasts,
);

check(
  'forecast availability does not decline',
  reports.control.total.availability,
  reports.candidate.total.availability,
);

for (const before of reports.control.total.perHorizon) {
  const after = reports.candidate.total.perHorizon.find((row) => row.horizon === before.horizon);

  const allowance =
    before.horizon <= 60 ? before.meanErrorPx * 0.02 : Math.max(2, before.meanErrorPx * 0.1);

  check(
    `${before.horizon}ms overall mean regression`,
    after.meanErrorPx,
    before.meanErrorPx + allowance,
  );
}

for (const group of ['byFamily', 'byProfile', 'bySplit']) {
  for (const [key, before] of Object.entries(reports.control[group])) {
    const after = reports.candidate[group][key];

    for (const original of before.perHorizon) {
      const updated = after.perHorizon.find((row) => row.horizon === original.horizon);

      check(
        `${group}/${key}/${original.horizon}ms mean regression`,
        updated.meanErrorPx,
        original.meanErrorPx + Math.max(2, original.meanErrorPx * 0.1),
      );
    }
  }
}

const result = {
  protocol: {
    purpose:
      'External regression on the prior comparison corpus, known/motion/sensor/combined, three seeds each. This corpus has historical model-development use; it is not the new untouched holdout. Geometric frame accuracy only; no action claims.',
    candidate: values.label,
    control: control.name,
    controlCommit: control.commit,
    candidateMetadata: candidateModule?.metadata ?? null,
    sourceSha256,
    traceIds: corpus.map((trace) => trace.id),
    p95Meaning: 'Mean of per-trace p95 errors, not pooled frame p95.',
  },
  models: reports,
  pairedMeanInterval: pairedInterval(rows.candidate, rows.control),
  acceptance: { passes: checks.every((entry) => entry.passes), checks },
  rows,
};

const output = resolve(values.output);

await mkdir(dirname(output), { recursive: true });

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });

console.log(
  JSON.stringify({
    output,
    passes: result.acceptance.passes,
    failedChecks: checks.filter((entry) => !entry.passes),
    total: Object.fromEntries(
      Object.entries(reports).map(([name, report]) => [name, report.total]),
    ),
    pairedMeanInterval: result.pairedMeanInterval,
  }),
);
