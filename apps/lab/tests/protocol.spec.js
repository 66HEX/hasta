import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, test } from '@playwright/test';

import { checksum } from '../src/checksum.ts';
import { importSession, readSession } from '../src/data.ts';
import { examplesFor, featuresAt } from '../src/features.ts';
import { sceneFor } from '../src/plan.ts';
import { collectionPlan, participants, recordCompletion, studySeed } from '../src/protocol.ts';
import { assessTrial } from '../src/quality.ts';
import { makeBackup, readBackup } from '../src/transfer.ts';

const provenance = JSON.parse(
  readFileSync(new URL('../dist/collection-build.json', import.meta.url), 'utf8'),
);

function fixture() {
  return {
    id: 'fixture',
    protocolVersion: 3,
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
      studyId: 'intent-5p-v1',
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
  const selected = plan.intended;

  const trial = {
    id: `${phase}-${index}`,
    plan,
    startedAt: session.createdAt,
    timeOrigin: 1,
    startTime: 1,
    duration: 200,
    board: { minX: 0, minY: 0, maxX: 800, maxY: 500 },
    targets: scene.targets,
    gate: selected === null ? scene.gate : null,
    gatePassedAt: selected === null ? 150 : null,
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
        minX: scene.start.x - 40,
        maxX: scene.start.x + 40,
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

test('balances all ten sessions and keeps every target distant and gates clear in four directions', () => {
  for (const participant of participants) {
    for (const number of [1, 2]) {
      const seed = studySeed(participant, number);
      const plans = Array.from({ length: 120 }, (_, index) => collectionPlan(seed, index, 'main'));
      expect(plans.filter((plan) => plan.mode === 'none')).toHaveLength(30);

      for (const count of [4, 8, 12]) {
        expect(plans.filter((plan) => plan.count === count)).toHaveLength(40);
      }

      for (const approach of ['left', 'right', 'top', 'bottom']) {
        expect(plans.filter((plan) => plan.approach === approach)).toHaveLength(30);
      }

      expect(
        new Set(plans.filter((plan) => plan.mode === 'none').map((plan) => plan.passage)).size,
      ).toBe(3);

      for (const plan of plans) {
        for (const [width, height] of [
          [580, 440],
          [1000, 650],
        ]) {
          const scene = sceneFor(plan, width, height);

          for (const { rect } of scene.targets) {
            const dx = Math.max(rect.minX - scene.start.x, scene.start.x - rect.maxX, 0);
            const dy = Math.max(rect.minY - scene.start.y, scene.start.y - rect.maxY, 0);
            expect(Math.hypot(dx, dy)).toBeGreaterThanOrEqual(200);
            expect(
              rect.minX >= 0 && rect.minY >= 0 && rect.maxX <= width && rect.maxY <= height,
            ).toBe(true);
            expect(
              rect.maxX < scene.gate.minX ||
                rect.minX > scene.gate.maxX ||
                rect.maxY < scene.gate.minY ||
                rect.minY > scene.gate.maxY,
            ).toBe(true);
          }
        }
      }
    }
  }
});

test('checks backup integrity, progression and quality from raw data, and reads legacy exports', async () => {
  const session = populated();
  expect(readSession(session)).toEqual(session);
  const backup = await makeBackup(session);
  expect(await readBackup(backup.blob)).toEqual(session);
  const sha256 = await checksum(JSON.stringify(session));

  const wrapper = {
    schemaVersion: 2,
    protocol: 'hasta-intent-5p-v3',
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
  const legacy = { ...fixture(), protocolVersion: 2, total: 12 };
  delete legacy.collection;

  const restored = await importSession(
    JSON.stringify({ schemaVersion: 1, protocol: 'hasta-intent-pilot-v2', session: legacy }),
  );

  expect(restored.protocolVersion).toBe(2);
});

test('retains wrong targets and slow input without turning them into negative intent labels', () => {
  const session = fixture();
  const plan = collectionPlan(session.seed, 0, 'warmup');
  const wrong = plan.intended === '0' ? '1' : '0';
  const failed = trialFor(session, 'warmup', 0, { selected: wrong, outcome: 'selected' });
  expect(failed.quality.eligible).toBe(false);
  expect(failed.quality.flags).toContain('instruction-mismatch');
  const retry = recordCompletion(session, failed);
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

test('uses only available motion, has candidate symmetry, and weights each trial equally', () => {
  const trial = populated().trials[12];
  const feature = featuresAt(trial, 110);
  expect(feature.candidate[0]).toHaveLength(24);
  expect(feature.none).toHaveLength(12);
  expect(
    [...feature.candidate.flat(), ...feature.none].every((value) => Number.isFinite(value)),
  ).toBe(true);
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
  expect(rows.every((row) => row.at < 185)).toBe(true);
  expect(examplesFor(populated().trials[0])).toEqual([]);
});

test('deduplicates checkpoints and rejects automated or incomplete study datasets by default', async () => {
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
    expect(manifest.sessions).toHaveLength(1);
    expect(manifest.trialCount).toBe(24);
    expect(manifest.exampleCount).toBeGreaterThan(24);
    expect(manifest.folds.every((fold) => !fold.train.includes(fold.test))).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
