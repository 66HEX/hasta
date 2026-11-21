import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import { checksum } from '../src/checksum.ts';
import { importSession, readSession } from '../src/data.ts';
import { examplesFor, featuresAt, replayFramesFor } from '../src/features.ts';
import { sceneFor } from '../src/plan.ts';
import {
  collectionPlan,
  legacyCollectionPlanV3,
  participants,
  PROTOCOL,
  recordCompletion,
  STUDY_ID,
  studySeed,
} from '../src/protocol.ts';
import { assessTrial } from '../src/quality.ts';
import { makeBackup, readBackup } from '../src/transfer.ts';

const provenance = JSON.parse(
  readFileSync(new URL('../dist/collection-build.json', import.meta.url), 'utf8'),
);

function fixture() {
  return {
    id: 'fixture',
    protocolVersion: 4,
    createdAt: '2026-11-14T00:00:00.000Z',
    participant: 'P01',
    device: 'mouse',
    seed: studySeed('P01', 1),
    total: 120,
    nextIndex: 0,
    provenance,
    environment: {
      userAgent: 'automated-test',
      width: 1280,
      height: 720,
      dpr: 1,
      coalesced: false,
      automated: true,
    },
    baseline: { horizonMs: 160, stableForMs: 30, maxSampleAgeMs: 100, once: true },
    trials: [],
    collection: {
      studyId: STUDY_ID,
      recordingId: 'fixture-recording',
      number: 1,
      phase: 'warmup',
      warmupNext: 0,
      acknowledgedBoundary: 0,
      revision: 1,
      exports: [],
    },
  };
}

function trialFor(session, phase, index, overrides = {}) {
  const plan = collectionPlan(session.seed, index, phase);
  const scene = sceneFor(plan, 800, 500);
  const selected = plan.mode === 'free' ? '0' : plan.intended;
  const requiresGate = plan.mode === 'none' && plan.noneVariant !== 'away';

  const trial = {
    id: `${phase}-${index}`,
    plan,
    startedAt: session.createdAt,
    timeOrigin: 1,
    startTime: 1,
    duration: 200,
    board: { minX: 0, minY: 0, maxX: 800, maxY: 500 },
    targets: scene.targets,
    gate: requiresGate ? scene.gate : null,
    gatePassedAt: requiresGate ? 150 : null,
    samples: Array.from({ length: 12 }, (_, i) => ({
      x: scene.start.x + i * 10,
      y: scene.start.y + i,
      timeStamp: i * 16 + 1,
      arrivedAt: i * 16 + 2,
      batch: i + 1,
      buttons: 0,
    })),
    frames: [],
    ticks: Array.from({ length: 12 }, (_, i) => i * 16 + 3),
    callbacks: [],
    events: selected === null ? [] : [{ type: 'enter', target: selected, at: 185 }],
    outcome: selected === null ? 'none' : 'selected',
    selected,
    reason: null,
    context: {
      attempt: 1,
      start: scene.start,
      startRect: {
        minX: scene.start.x - 42,
        maxX: scene.start.x + 42,
        minY: scene.start.y - 20,
        maxY: scene.start.y + 20,
      },
      finishRect: null,
      end: null,
      viewport: { width: 1280, height: 720, dpr: 1, scrollX: 0, scrollY: 0 },
    },
    ...overrides,
  };

  trial.quality = assessTrial(trial);

  return trial;
}

function populated() {
  let session = fixture();

  for (let i = 0; i < 12; i++) {
    session = recordCompletion(session, trialFor(session, 'warmup', i));
  }

  session.collection.phase = 'main';

  for (let i = 0; i < 24; i++) {
    session = recordCompletion(session, trialFor(session, 'main', i));
  }

  return session;
}

function overlaps(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function checkScene(plan, width, height, tag, stats, violations) {
  const scene = sceneFor(plan, width, height);

  const startRect = {
    minX: scene.start.x - 42,
    minY: scene.start.y - 20,
    maxX: scene.start.x + 42,
    maxY: scene.start.y + 20,
  };

  const finishRect = {
    minX: scene.finish.x - 36,
    minY: scene.finish.y - 18,
    maxX: scene.finish.x + 36,
    maxY: scene.finish.y + 18,
  };

  let nearestStart = Infinity;

  for (let i = 0; i < scene.targets.length; i++) {
    const { rect } = scene.targets[i];
    stats.minWidth = Math.min(stats.minWidth, rect.maxX - rect.minX);
    stats.maxWidth = Math.max(stats.maxWidth, rect.maxX - rect.minX);
    stats.minHeight = Math.min(stats.minHeight, rect.maxY - rect.minY);
    stats.maxHeight = Math.max(stats.maxHeight, rect.maxY - rect.minY);

    if (rect.minX < 0 || rect.minY < 0 || rect.maxX > width || rect.maxY > height) {
      violations.push(`${tag} out-of-bounds ${plan.layout}`);
    }

    if (overlaps(rect, startRect)) {
      violations.push(`${tag} start-overlap ${plan.layout}`);
    }

    if (plan.mode === 'none' && overlaps(rect, finishRect)) {
      violations.push(`${tag} finish-overlap ${plan.layout}`);
    }

    if (plan.mode === 'none' && plan.noneVariant === 'gate' && overlaps(rect, scene.gate)) {
      violations.push(`${tag} gate-overlap ${plan.layout}`);
    }

    for (let j = i + 1; j < scene.targets.length; j++) {
      if (overlaps(rect, scene.targets[j].rect)) {
        violations.push(`${tag} target-overlap ${plan.layout}`);
      }
    }

    const dx = Math.max(rect.minX - scene.start.x, scene.start.x - rect.maxX, 0);
    const dy = Math.max(rect.minY - scene.start.y, scene.start.y - rect.maxY, 0);
    nearestStart = Math.min(nearestStart, Math.hypot(dx, dy));
  }

  stats.minStartDist = Math.min(stats.minStartDist, nearestStart);
  stats.maxStartDist = Math.max(stats.maxStartDist, nearestStart);
}

test('balances all 48 sessions across 5 realistic UI layouts, varied sizes, and non-overlapping geometry', () => {
  expect(participants).toHaveLength(24);

  const stats = {
    minWidth: Infinity,
    maxWidth: 0,
    minHeight: Infinity,
    maxHeight: 0,
    minStartDist: Infinity,
    maxStartDist: 0,
  };

  for (const participant of participants) {
    for (const number of [1, 2]) {
      const seed = studySeed(participant, number);
      const plans = Array.from({ length: 120 }, (_, index) => collectionPlan(seed, index, 'main'));
      expect(plans.filter((plan) => plan.mode === 'select')).toHaveLength(75);
      expect(plans.filter((plan) => plan.mode === 'free')).toHaveLength(15);
      expect(plans.filter((plan) => plan.mode === 'none')).toHaveLength(30);
      expect(plans.filter((plan) => plan.noneVariant === 'gate')).toHaveLength(15);
      expect(plans.filter((plan) => plan.noneVariant === 'away')).toHaveLength(15);

      for (const count of [4, 8, 12]) {
        expect(plans.filter((plan) => plan.count === count)).toHaveLength(40);
      }

      for (const approach of ['left', 'right', 'top', 'bottom']) {
        expect(plans.filter((plan) => plan.approach === approach)).toHaveLength(30);
      }

      for (const layout of ['grid', 'navbar', 'sidebar', 'cards', 'cluster']) {
        expect(plans.filter((plan) => plan.layout === layout)).toHaveLength(24);
      }

      for (const startKind of ['far', 'medium', 'near']) {
        expect(plans.filter((plan) => plan.startKind === startKind)).toHaveLength(40);
      }

      const violations = [];

      for (const plan of plans) {
        const tag = `${participant}/${number}#${plan.index}`;
        checkScene(plan, 580, 440, tag, stats, violations);
        checkScene(plan, 1000, 650, tag, stats, violations);
      }

      expect(violations).toEqual([]);
    }
  }

  expect(stats.minWidth).toBeLessThanOrEqual(45);
  expect(stats.maxWidth).toBeGreaterThanOrEqual(130);
  expect(stats.minHeight).toBeLessThanOrEqual(34);
  expect(stats.maxHeight).toBeGreaterThanOrEqual(70);
  expect(stats.minStartDist).toBeLessThan(85);
  expect(stats.maxStartDist).toBeGreaterThan(200);
});

test('checks backup integrity, progression and quality from raw data, and reads legacy v2/v3 exports', async () => {
  const session = populated();
  expect(readSession(session)).toEqual(session);
  const backup = await makeBackup(session);
  expect(await readBackup(backup.blob)).toEqual(session);
  const sha256 = await checksum(JSON.stringify(session));

  const wrapper = {
    schemaVersion: 2,
    protocol: PROTOCOL,
    sha256,
    session: { ...session, participant: 'P02' },
  };

  await expect(importSession(JSON.stringify(wrapper))).rejects.toThrow('checksum');
  expect(() => readSession({ ...session, nextIndex: 25 })).toThrow('progress');
  expect(() =>
    readSession({ ...session, collection: { ...session.collection, phase: 'instructions' } }),
  ).toThrow('progress');
  const forged = structuredClone(session);
  forged.trials[12].plan.approach = 'invalid';
  expect(() => readSession(forged)).toThrow();

  // Legacy v2 export
  const legacyV2 = { ...fixture(), protocolVersion: 2, total: 12 };
  delete legacyV2.collection;

  const restoredV2 = await importSession(
    JSON.stringify({ schemaVersion: 1, protocol: 'hasta-intent-pilot-v2', session: legacyV2 }),
  );

  expect(restoredV2.protocolVersion).toBe(2);

  // Legacy v3 export
  const legacyV3 = {
    ...fixture(),
    protocolVersion: 3,
    collection: { ...fixture().collection, studyId: 'intent-5p-v1' },
  };

  const v3Plan = legacyCollectionPlanV3(legacyV3.seed, 0, 'warmup');
  expect(v3Plan.startKind).toBeUndefined();
  const v3Sha = await checksum(JSON.stringify(legacyV3));

  const restoredV3 = await importSession(
    JSON.stringify({
      schemaVersion: 2,
      protocol: 'hasta-intent-5p-v3',
      sha256: v3Sha,
      session: legacyV3,
    }),
  );

  expect(restoredV3.protocolVersion).toBe(3);
});

test('retains wrong targets and slow input, and accepts free-choice selections', () => {
  const session = fixture();

  const selectIndex = Array.from({ length: 12 }, (_, i) => i).find(
    (i) => collectionPlan(session.seed, i, 'warmup').mode === 'select',
  );

  const plan = collectionPlan(session.seed, selectIndex, 'warmup');
  const wrong = plan.intended === '0' ? '1' : '0';
  const failed = trialFor(session, 'warmup', selectIndex, { selected: wrong, outcome: 'selected' });
  expect(failed.quality.eligible).toBe(false);
  expect(failed.quality.flags).toContain('instruction-mismatch');

  const freeIndex = Array.from({ length: 12 }, (_, i) => i).find(
    (i) => collectionPlan(session.seed, i, 'warmup').mode === 'free',
  );

  const freeTrial = trialFor(session, 'warmup', freeIndex, { selected: '2', outcome: 'selected' });
  expect(freeTrial.quality.eligible).toBe(true);

  const firstFailed = trialFor(session, 'warmup', 0, { outcome: 'timeout', selected: null });
  const retry = recordCompletion(session, firstFailed);
  expect(retry.collection.warmupNext).toBe(0);
  const second = trialFor(retry, 'warmup', 0, { id: 'second', outcome: 'timeout', selected: null });
  second.context.attempt = 2;
  const next = recordCompletion(retry, second);
  expect(readSession(next).trials).toHaveLength(2);
  expect(next.collection.warmupNext).toBe(1);

  const slow = trialFor(session, 'main', 0);
  slow.duration = 1000;
  slow.events = [];
  slow.samples[11].timeStamp = 800;
  slow.samples[11].arrivedAt = 801;
  expect(assessTrial(slow).flags).toContain('input-gap');
  expect(assessTrial(slow).eligible).toBe(true);
});

test('uses only available motion, has candidate symmetry, relative distance gap, and replay frames', () => {
  const trial = populated().trials[12];
  const feature = featuresAt(trial, 110);
  expect(feature.candidate[0]).toHaveLength(24);
  expect(feature.none).toHaveLength(12);
  expect(
    [...feature.candidate.flat(), ...feature.none].every((value) => Number.isFinite(value)),
  ).toBe(true);
  // Index 5 is distGap (dist - minDist): minimum across candidates must be 0
  expect(Math.min(...feature.candidate.map((values) => values[5]))).toBe(0);
  const future = structuredClone(trial);
  future.samples.push({ x: 9999, y: 9999, timeStamp: 111, arrivedAt: 111, buttons: 0, batch: 99 });
  future.plan.intended = 'different';
  future.plan.mode = 'none';
  expect(featuresAt(future, 110)).toEqual(feature);
  future.targets.reverse();
  expect(featuresAt(future, 110).candidate).toEqual(feature.candidate.toReversed());
  expect(featuresAt(future, 110).none).toEqual(feature.none);
  expect(featuresAt(trial, 1000)).toBeNull();
  const rows = examplesFor(trial);
  expect(rows.length).toBeGreaterThan(2);
  expect(rows.reduce((sum, row) => sum + row.weight, 0)).toBeCloseTo(1);
  expect(examplesFor(populated().trials[0])).toEqual([]);
  const replays = replayFramesFor(trial);
  expect(replays.length).toBeGreaterThan(2);
  expect(replays[0].inside).toHaveLength(trial.targets.length);
});

test('deduplicates checkpoints, exports replay frames, and rejects automated or incomplete datasets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hasta-prepare-'));
  const run = promisify(execFile);
  const script = new URL('../scripts/prepare.mjs', import.meta.url).pathname;

  try {
    const session = populated();
    const backup = await makeBackup(session);
    const file = join(directory, 'session.json.gz');
    await writeFile(file, new Uint8Array(await backup.blob.arrayBuffer()));
    await expect(
      run(process.execPath, [script, '--out', join(directory, 'rejected'), file]),
    ).rejects.toThrow('Automated recording excluded');
    await expect(
      run(process.execPath, [
        script,
        '--allow-automated',
        '--require-complete',
        '--out',
        join(directory, 'incomplete'),
        file,
      ]),
    ).rejects.toThrow('Incomplete study');
    await run(process.execPath, [
      script,
      '--allow-automated',
      '--out',
      join(directory, 'prepared'),
      file,
      file,
    ]);
    const manifest = JSON.parse(await readFile(join(directory, 'prepared/manifest.json'), 'utf8'));
    expect(manifest.protocol).toBe(PROTOCOL);
    expect(manifest.sessions).toHaveLength(1);
    expect(manifest.trialCount).toBe(24);
    expect(manifest.replayCount).toBe(24);
    expect(manifest.exampleCount).toBeGreaterThan(24);
    expect(manifest.folds.every((fold) => !fold.train.includes(fold.test))).toBe(true);

    const replayLines = (await readFile(join(directory, 'prepared/replay.jsonl'), 'utf8'))
      .trim()
      .split('\n');

    expect(replayLines).toHaveLength(24);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
