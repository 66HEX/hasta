import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { KalmanPredictor as CurrentPredictor } from '../../dist/core/prediction/kalman-predictor.js';
import { KalmanPredictor as ControlPredictor } from './baseline-fa9ac8d/core/prediction/kalman-predictor.js';
import { createCorpus } from './corpus.mjs';
import { replayTrace, aggregateActions, evaluateActions, selectPolicy } from './evaluate.mjs';
import {
  FILTER_GATES,
  actionReport,
  filterReport,
  pairedFilterComparison,
  assessFilter,
  validateSelectionProtocol,
} from './filter-evaluation.mjs';
import { precisionReport } from './filter-scenarios.mjs';

const { values } = parseArgs({
  options: {
    output: { type: 'string', default: '/tmp/hasta-filter/results.json' },
    candidate: { type: 'string' },
    label: { type: 'string', default: 'current-production' },
    stage: { type: 'string', default: 'development' },
    selection: { type: 'string' },
    repeats: { type: 'string', default: '12' },
    'seed-offset': { type: 'string', default: '240000000' },
  },
});

if (!['development', 'final'].includes(values.stage)) {
  throw new Error('stage must be development or final.');
}

if (values.stage === 'final' && values.selection === undefined) {
  throw new Error('Final evaluation requires a frozen development selection artifact.');
}

const output = resolve(values.output);
const packageRoot = fileURLToPath(new URL('../../', import.meta.url));
const candidatePath = values.candidate === undefined ? null : resolve(values.candidate);
const candidateModule = candidatePath === null ? null : await import(pathToFileURL(candidatePath));
const CandidatePredictor = candidateModule?.KalmanPredictor ?? CurrentPredictor;

if (candidateModule !== null && candidateModule.KalmanPredictor === undefined) {
  throw new Error('Candidate module must export KalmanPredictor.');
}

const factories = {
  control: () => new ControlPredictor(),
  candidate: () => new CandidatePredictor(),
};

const policies = [60, 120, 160].flatMap((horizonMs) =>
  [0, 16, 30, 50].map((stableForMs) => ({ horizonMs, stableForMs, evidence: 'fresh' })),
);

const budgets = [0, 2, 5, 10];
const split = values.stage === 'development' ? 'validation' : 'test';
const corpus = createCorpus(split, Number(values.repeats), Number(values['seed-offset']));
const hashes = {};

async function fingerprint(path) {
  hashes[relative(packageRoot, path)] = createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
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
  'benchmarks/stability/filter-evaluation.mjs',
  'benchmarks/stability/filter-run.mjs',
  'benchmarks/stability/filter-scenarios.mjs',
  'benchmarks/stability/baseline-fa9ac8d/manifest.json',
];

for (const path of sourceFiles) {
  await fingerprint(resolve(packageRoot, path));
}

if (candidatePath !== null) {
  for (const path of await readdir(dirname(candidatePath), { recursive: true })) {
    if (/\.(?:mjs|js|json)$/u.test(path)) {
      await fingerprint(resolve(dirname(candidatePath), path));
    }
  }
}

const selectionText =
  values.selection === undefined ? null : await readFile(resolve(values.selection), 'utf8');

const selection = selectionText === null ? null : JSON.parse(selectionText);

if (
  selection !== null &&
  (selection.protocol.stage !== 'development' || selection.protocol.candidate !== values.label)
) {
  throw new Error('Selection must be a development artifact with the same candidate label.');
}

const result = {
  protocol: {
    version: 'filter-acceptance-v1',
    stage: values.stage,
    candidate: values.label,
    candidateModule:
      candidatePath === null ? 'current-production' : relative(packageRoot, candidatePath),
    candidateMetadata: candidateModule?.metadata ?? null,
    purpose:
      'Numerical filter comparison with the same current fresh-evidence Subscription on both sides. Synthetic engineering gates, not human efficacy.',
    control:
      'Frozen fa9ac8d Kalman predictor, byte-identical source to the previous-turn production filter; current callback policy, not the frozen legacy Subscription.',
    split,
    seedOffset: Number(values['seed-offset']),
    repeats: Number(values.repeats),
    traceIds: corpus.map((trace) => trace.id),
    gates: FILTER_GATES,
    sourceSha256: hashes,
    selectionSha256:
      selectionText === null ? null : createHash('sha256').update(selectionText).digest('hex'),
    selectionProtocol: selection?.protocol ?? null,
    policySelection:
      'Existing horizon/stability options selected on development validation only; final evaluation reuses those frozen selections. Fixed120/30 is the primary action comparison.',
  },
  node: process.version,
  models: {},
};

if (selection !== null) {
  validateSelectionProtocol(result.protocol, selection.protocol);
}

const replays = Object.fromEntries(
  Object.entries(factories).map(([name, factory]) => [
    name,
    corpus.map((trace) => replayTrace(trace, name, factory)),
  ]),
);

for (const [name, replay] of Object.entries(replays)) {
  const report = filterReport(replay);

  if (values.stage === 'development') {
    const candidates = policies.map((policy) => ({
      policy,
      metrics: aggregateActions(replay.map((trace) => evaluateActions(trace, policy))),
    }));

    report.policyCandidates = candidates;

    report.selected = budgets.map((budget) => {
      const selected = selectPolicy(candidates, budget);

      return { budget, policy: selected?.policy ?? null, validation: selected?.metrics ?? null };
    });
  } else {
    report.selected = selection.models[name].selected;
  }

  report.matchedBudgets = report.selected.map(({ budget, policy }) => ({
    budget,
    ...actionReport(replay, policy),
  }));

  result.models[name] = report;
}

result.paired = pairedFilterComparison(
  replays.control,
  replays.candidate,
  result.models.control,
  result.models.candidate,
);

result.acceptance = assessFilter(result.models.control, result.models.candidate, result.paired);

result.precision = Object.fromEntries(
  Object.entries(factories).map(([name, factory]) => [name, precisionReport(factory)]),
);

result.acceptance.checks.push({
  name: 'existing narrow-channel and reversal episode contracts preserved',
  actual: result.precision.candidate.passes,
  limit: true,
  passes: result.precision.control.passes && result.precision.candidate.passes,
});

result.acceptance.passes = result.acceptance.checks.every((check) => check.passes);

await mkdir(dirname(output), { recursive: true });

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });

console.log(
  JSON.stringify({
    output,
    stage: values.stage,
    candidate: values.label,
    passes: result.acceptance.passes,
    failedChecks: result.acceptance.checks.filter((check) => !check.passes),
    paired: result.paired,
    fixed: Object.fromEntries(
      Object.entries(result.models).map(([name, report]) => [name, report.fixed.metrics]),
    ),
  }),
);
