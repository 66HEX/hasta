import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { KalmanPredictor } from '../../dist/core/prediction/kalman-predictor.js';
import { createCorpus, PROFILES } from './corpus.mjs';
import { replayTrace } from './evaluate.mjs';
import { loadFilterControl } from './filter-controls.mjs';
import {
  pairedFilterComparison,
  assessFilter,
  validateSelectionProtocol,
} from './filter-evaluation.mjs';
import { balancedCorpus, cadencePrecision } from './filter-resample.mjs';
import { precisionReport } from './filter-scenarios.mjs';
import {
  STUDY_GATES,
  studyStage,
  compactReplay,
  studyReport,
  assessStudy,
  motionSeeds,
} from './filter-study.mjs';

const { values } = parseArgs({
  options: {
    candidate: { type: 'string' },
    label: { type: 'string', default: 'current-production' },
    stage: { type: 'string', default: 'development' },
    repeats: { type: 'string', default: '12' },
    selection: { type: 'string' },
    output: { type: 'string', default: '/tmp/hasta-filter-study/results.json' },
  },
});

const stage = studyStage(values.stage, Number(values.repeats));
const root = fileURLToPath(new URL('../../', import.meta.url));
const candidatePath = values.candidate === undefined ? null : resolve(values.candidate);
const candidateModule = candidatePath === null ? null : await import(pathToFileURL(candidatePath));
const CandidatePredictor = candidateModule?.KalmanPredictor ?? KalmanPredictor;

if (candidateModule !== null && candidateModule.KalmanPredictor === undefined) {
  throw new Error('Candidate module must export KalmanPredictor.');
}

const control = await loadFilterControl('0a503bb');
const factories = { control: control.create, candidate: () => new CandidatePredictor() };
const sourceSha256 = {};

const sourceFiles = [
  'src/core/prediction/kalman-state.ts',
  'src/core/prediction/kalman-predictor.ts',
  'src/core/line-rect.ts',
  'src/core/validation.ts',
  'src/runtime/engine.ts',
  'src/runtime/triggers/subscription.ts',
  'dist/core/prediction/kalman-state.js',
  'dist/core/prediction/kalman-predictor.js',
  'dist/core/line-rect.js',
  'dist/core/validation.js',
  'dist/core/geometry.js',
  'benchmarks/comparison/corpus.mjs',
  'dist/runtime/engine.js',
  'dist/runtime/triggers/subscription.js',
  ...[
    'corpus.mjs',
    'evaluate.mjs',
    'filter-controls.mjs',
    'filter-evaluation.mjs',
    'filter-resample.mjs',
    'filter-scenarios.mjs',
    'filter-study.mjs',
    'filter-study-run.mjs',
    'SPARSE-FILTER-PROTOCOL.md',
  ].map((file) => `benchmarks/stability/${file}`),
  ...control.sourceFiles,
];

if (candidatePath !== null) {
  for (const path of await readdir(dirname(candidatePath), { recursive: true })) {
    if (/\.(?:mjs|js|json)$/u.test(path)) {
      sourceFiles.push(relative(root, resolve(dirname(candidatePath), path)));
    }
  }
}

for (const file of sourceFiles) {
  sourceSha256[file] = createHash('sha256')
    .update(await readFile(resolve(root, file)))
    .digest('hex');
}

const selectionText =
  values.selection === undefined ? null : await readFile(resolve(values.selection), 'utf8');

const selection = selectionText === null ? null : JSON.parse(selectionText);

if (
  ['final', 'cadence'].includes(values.stage) &&
  (selection?.protocol.stage !== 'development' || !selection.acceptance.passes)
) {
  throw new Error(
    'Cadence validation and final evaluation require a passing development selection.',
  );
}

if (values.stage === 'final' && candidatePath !== null) {
  throw new Error('Final evaluation must use the approved built production implementation.');
}

const protocol = {
  version: 'sparse-input-filter-v2',
  stage: values.stage,
  candidate: values.label,
  candidateModule: candidatePath === null ? 'current-production' : relative(root, candidatePath),
  candidateMetadata: candidateModule?.metadata ?? null,
  control: control.name,
  controlCommit: control.commit,
  repeats: stage.repeats,
  split: stage.split,
  seedOffset: stage.seedOffset,
  motionSeeds: motionSeeds(stage.split, stage.repeats, stage.seedOffset),
  cadences: stage.cadences,
  gates: STUDY_GATES,
  sourceSha256,
  traceIds: [],
  selectionSha256:
    selectionText === null ? null : createHash('sha256').update(selectionText).digest('hex'),
  purpose:
    'Balanced cadence primary against the previous accepted Hasta filter. Synthetic evidence; no human efficacy claim. Primary and legacy use the same current Subscription and fixed120/30 policy.',
  inspiration: 'Independent time-window and braking hypotheses for the existing Kalman predictor.',
};

// Validate source identity before generating or replaying a reserved corpus
if (selection !== null) {
  validateSelectionProtocol(
    { ...protocol, stage: 'final', traceIds: [`reserved/${stage.split}/${stage.seedOffset}`] },
    selection.protocol,
  );
}

const replays = { control: [], candidate: [] };

for (const trace of balancedCorpus(stage.split, stage.repeats, stage.seedOffset, stage.cadences)) {
  protocol.traceIds.push(trace.id);

  for (const [name, factory] of Object.entries(factories)) {
    replays[name].push(compactReplay(replayTrace(trace, name, factory)));
  }
}

if (selection !== null) {
  validateSelectionProtocol({ ...protocol, stage: 'final' }, selection.protocol);
}

const primary = assessStudy(replays.control, replays.candidate, values.stage === 'cadence');

const legacyReplays = Object.fromEntries(
  Object.entries(factories).map(([name, factory]) => [
    name,
    createCorpus(stage.split, stage.repeats, stage.seedOffset).map((trace) =>
      compactReplay(replayTrace(trace, name, factory)),
    ),
  ]),
);

const legacyModels = Object.fromEntries(
  Object.entries(legacyReplays).map(([name, entries]) => [name, studyReport(entries, PROFILES)]),
);

const legacyPaired = pairedFilterComparison(
  legacyReplays.control,
  legacyReplays.candidate,
  legacyModels.control,
  legacyModels.candidate,
);

const legacy = {
  models: legacyModels,
  paired: legacyPaired,
  acceptance: assessFilter(legacyModels.control, legacyModels.candidate, legacyPaired, true),
};

const precision = Object.fromEntries(
  Object.entries(factories).map(([name, factory]) => [name, precisionReport(factory)]),
);

const cadence = cadencePrecision(factories, stage.cadences);

const checks = [
  ...primary.acceptance.checks.map((check) => ({ ...check, suite: 'primary' })),
  ...legacy.acceptance.checks.map((check) => ({ ...check, suite: 'legacy' })),
  {
    name: 'exact browser precision contracts preserved',
    passes: precision.control.passes && precision.candidate.passes,
  },
  {
    name: 'control-supported cadence precision episodes preserved',
    passes: cadence.every((row) => !row.regression),
  },
];

const result = {
  protocol,
  node: process.version,
  primary,
  legacy,
  precision,
  cadence,
  acceptance: { passes: checks.every((check) => check.passes), checks },
};

const output = resolve(values.output);

await mkdir(dirname(output), { recursive: true });

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });

console.log(
  JSON.stringify({
    output,
    stage: values.stage,
    traces: protocol.traceIds.length,
    passes: result.acceptance.passes,
    failedChecks: checks.filter((check) => !check.passes),
    primary: primary.paired,
    targeted: primary.targeted,
    actions: Object.fromEntries(
      Object.entries(primary.models).map(([name, report]) => [name, report.fixed.metrics]),
    ),
    immediateDiagnostic: Object.fromEntries(
      Object.entries(primary.models).map(([name, report]) => [
        name,
        report.immediateDiagnostic.metrics,
      ]),
    ),
  }),
);
