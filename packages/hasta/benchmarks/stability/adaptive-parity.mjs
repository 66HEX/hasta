import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

import { KalmanPredictor } from '../../dist/core/index.js';
import { createCorpus } from './corpus.mjs';
import { replayTrace } from './evaluate.mjs';
import { loadFilterControl } from './filter-controls.mjs';
import { balancedCorpus } from './filter-resample.mjs';
import { STUDY_CADENCES, VALIDATION_CADENCES } from './filter-study.mjs';
import { recordingFactory } from './iteration3-study.mjs';

const { values } = parseArgs({ options: { output: { type: 'string' } } });

if (!values.output) {
  throw new Error('Use --output with a new result file.');
}

const control = await loadFilterControl('d514639');
const factories = [control.create, () => new KalmanPredictor()];
const counts = { traces: 0, updates: 0, resets: 0, predictions: 0, intersections: 0 };
const digest = createHash('sha256');

const suites = [
  { name: 'balanced', corpus: () => balancedCorpus('validation', 3, 2400000000, STUDY_CADENCES) },
  {
    name: 'additional-cadences',
    corpus: () => balancedCorpus('test', 3, 2520000000, VALIDATION_CADENCES),
  },
  { name: 'legacy-profiles', corpus: () => createCorpus('test', 3, 2640000000) },
];

for (const suite of suites) {
  for (const trace of suite.corpus()) {
    const rows = factories.map((factory) => {
      const recorder = recordingFactory(factory);
      const replay = replayTrace(trace, 'candidate', recorder.create);

      return {
        recorded: recorder.finish(null, null),
        errors: replay.errors,
        frames: replay.frames,
      };
    });

    assert.deepEqual(rows[1], rows[0], trace.id);
    counts.traces++;

    for (const key of ['updates', 'resets', 'predictions', 'intersections']) {
      counts[key] += rows[0].recorded[key];
    }

    digest.update(trace.id).update(rows[0].recorded.querySha256);
  }

  console.log(JSON.stringify({ suite: suite.name, ...counts }));
}

const fingerprints = {};

for (const file of [
  'src/core/prediction/kalman-predictor.ts',
  'src/core/prediction/kalman-state.ts',
  'dist/core/prediction/kalman-predictor.js',
  'dist/core/prediction/kalman-state.js',
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
      ...counts,
      mismatches: 0,
      combinedQuerySha256: digest.digest('hex'),
      fingerprints,
      scope:
        'Exact Float64 forecast/intersection and availability parity, plus identical frame decisions and endpoint errors. The legacy replay does not model release hysteresis; real runtime behavior is covered by browser tests.',
    },
    null,
    2,
  )}\n`,
  { flag: 'wx' },
);
