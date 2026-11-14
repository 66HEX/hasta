import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createCorpus, PROFILES } from '../benchmarks/stability/corpus.mjs';
import { replayTrace, evaluateActions } from '../benchmarks/stability/evaluate.mjs';
import { loadFilterControl } from '../benchmarks/stability/filter-controls.mjs';
import {
  filterReport,
  validateSelectionProtocol,
  assessFilter,
} from '../benchmarks/stability/filter-evaluation.mjs';
import { balancedCorpus, cadencePrecision } from '../benchmarks/stability/filter-resample.mjs';
import {
  STUDY_CADENCES,
  studyStage,
  motionSeeds,
  compactReplay,
  studyReport,
} from '../benchmarks/stability/filter-study.mjs';

test('second numerical control preserves pinned source and compiled bytes without changing historical default', async () => {
  assert.equal((await loadFilterControl()).name, 'fa9ac8d');
  const control = await loadFilterControl('0a503bb');
  assert.equal(control.commit, '0a503bbc60adfdece2ca42f06a67b0254966c93b');
  const root = new URL('../benchmarks/stability/baseline-0a503bb/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));

  for (const [file, expected] of Object.entries(manifest.sourceSha256)) {
    assert.equal(
      createHash('sha256')
        .update(await readFile(new URL(`src/${file}`, root)))
        .digest('hex'),
      expected,
    );
  }

  await assert.rejects(loadFilterControl('../arbitrary-module'));
});

test('compacted study replay preserves forecasts and fixed-action evaluation exactly', async () => {
  const control = await loadFilterControl('0a503bb');
  const trace = createCorpus('calibration', 1, 960000000)[0];
  const replay = replayTrace(trace, 'control', control.create);

  const full = filterReport([replay], PROFILES, [
    evaluateActions(replay, { horizonMs: 120, stableForMs: 30, evidence: 'fresh' }, 1, true),
  ]);

  const { immediateDiagnostic, ...compacted } = studyReport([compactReplay(replay)], PROFILES);
  assert.deepEqual(compacted, full);
  assert.equal(immediateDiagnostic.policy.stableForMs, 0);
  assert.ok(immediateDiagnostic.metrics.trials > 0);
});

test('balanced variants retain whole-motion blocks and cadence-independent truth', () => {
  const variants = [...balancedCorpus('calibration', 1, 960000000, STUDY_CADENCES)];
  assert.equal(variants.length, 384);
  const blocks = Map.groupBy(variants, (trace) => trace.block);
  assert.equal(blocks.size, 8);

  for (const traces of blocks.values()) {
    assert.equal(traces.length, 48);
    assert.equal(new Set(traces.map((trace) => trace.id)).size, 48);
    assert.ok(traces.every((trace) => trace.position === traces[0].position));
    assert.ok(traces.every((trace) => trace.targets === traces[0].targets));
  }
});

test('reserved seed arithmetic matches corpus seeds without generating holdout trajectories', () => {
  const actual = new Set(createCorpus('validation', 1, 960000000).map((trace) => trace.seed));
  assert.deepEqual(new Set(motionSeeds('validation', 1, 960000000)), actual);
  const seen = new Set();

  for (const stage of ['training', 'development', 'cadence', 'final']) {
    const config = studyStage(stage);
    const seeds = motionSeeds(config.split, config.repeats, config.seedOffset);
    assert.equal(new Set(seeds).size, 96);

    for (const seed of seeds) {
      assert.equal(seen.has(seed), false);
      seen.add(seed);
    }
  }

  for (const offset of [0, 110000000, 150000000, 190000000, 240000000, 480000000, 720000000]) {
    for (const split of ['calibration', 'validation', 'test']) {
      assert.ok(motionSeeds(split, 12, offset).every((seed) => !seen.has(seed)));
    }
  }
});

test('only exploratory training allows fewer repeats than the preregistered selection', () => {
  assert.equal(studyStage('training', 3).repeats, 3);
  assert.throws(() => studyStage('development', 3));
  assert.throws(() => studyStage('final', 3));
  assert.throws(() => studyStage('unknown'));
});

test('cadence precision preserves a supported later episode even when another baseline phase is unavailable', async () => {
  const control = await loadFilterControl('0a503bb');

  const candidate = () => {
    const model = control.create();

    return {
      update: (sample) => model.update(sample),
      reset: () => model.reset(),
      predict: (now, horizon) => model.predict(now, horizon),
      intersectRect: (now, horizon, rect) =>
        now >= 1112 ? null : model.intersectRect(now, horizon, rect),
    };
  };

  const rows = cadencePrecision({ control: control.create, candidate }, [1000 / 120]);
  const row = rows.find((entry) => entry.jitter && entry.id === 'narrow-channel');
  assert.equal(row.baselinePasses, false);
  assert.equal(row.regression, true);
  assert.equal(row.phases.find((phase) => phase.phase === 'reapproach').baselineAt, 1112);
  assert.equal(row.phases.find((phase) => phase.phase === 'reapproach').candidateAt, null);
});

test('selection checks explicit motion seeds when expanded trace ids end in profile names', () => {
  const selected = {
    version: 'v2',
    stage: 'development',
    candidate: 'one',
    candidateModule: 'current-production',
    repeats: 12,
    control: '0a503bb',
    controlCommit: 'pinned',
    gates: {},
    sourceSha256: {},
    traceIds: ['validation/path/100/8/false/noisy'],
    motionSeeds: [100],
  };

  const current = {
    ...selected,
    stage: 'final',
    traceIds: ['test/path/200/8/false/noisy'],
    motionSeeds: [200],
  };

  assert.doesNotThrow(() => validateSelectionProtocol(current, selected));
  assert.throws(() => validateSelectionProtocol({ ...current, motionSeeds: [100] }, selected));
  assert.throws(() => validateSelectionProtocol({ ...current, control: 'fa9ac8d' }, selected));
});

test('legacy non-inferiority still rejects a120ms mean regression above1percent', async () => {
  const control = await loadFilterControl('0a503bb');
  const traces = createCorpus('calibration', 1, 960000000);
  const report = filterReport(traces.map((trace) => replayTrace(trace, 'control', control.create)));

  const paired = {
    endpoint: [{ horizonMs: 120, upper95: 0 }],
    commonCorrectLeadDifferenceMs: { median: 0 },
  };

  assert.equal(assessFilter(report, report, paired, true).passes, true);
  assert.equal(assessFilter(report, report, paired).passes, false);
  const candidate = structuredClone(report);
  candidate.forecast.find((row) => row.horizonMs === 120).meanTraceErrorPx *= 1.011;
  assert.equal(assessFilter(report, candidate, paired, true).passes, false);
});
