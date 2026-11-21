/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type -- Imported JSON and IndexedDB records require validation at the boundary */
import type { Point, Rect } from '@66hex/hasta/core';

import { checksum } from './checksum.ts';
import {
  collectionPlan,
  legacyCollectionPlanV3,
  legacyParticipantsV3,
  participants,
  PROTOCOL,
  recordCompletion,
  STUDY_ID,
  studySeed,
} from './protocol.ts';
import { assessTrial } from './quality.ts';
import type {
  Callback,
  Collection,
  Frame,
  Plan,
  Sample,
  Session,
  Target,
  Trial,
  TrialEvent,
} from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('The file structure is invalid.');
  }

  return value;
}

function text(value: unknown, max = 500): string {
  if (typeof value !== 'string' || value.length > max) {
    throw new Error('A text field is invalid.');
  }

  return value;
}

function number(value: unknown, min = 0, max = 1e15): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error('The recording contains an invalid number.');
  }

  return value;
}

function integer(value: unknown, min = 0, max = 1e9): number {
  const result = number(value, min, max);

  if (!Number.isInteger(result)) {
    throw new TypeError('The recording contains an invalid index.');
  }

  return result;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError('The recording contains an invalid boolean.');
  }

  return value;
}

function array<T>(value: unknown, parse: (item: unknown) => T, max = 10000): T[] {
  if (!Array.isArray(value) || value.length > max) {
    throw new Error('The recording contains an invalid collection.');
  }

  return value.map((item) => parse(item));
}

function choice<T extends string>(value: unknown, options: readonly T[]): T {
  for (const option of options) {
    if (value === option) {
      return option;
    }
  }

  throw new Error('This recording type is not supported.');
}

function nullable(value: unknown): string | null {
  return value === null ? null : text(value);
}

function rect(value: unknown): Rect {
  const source = object(value);

  const result = {
    minX: number(source.minX, -100000, 100000),
    minY: number(source.minY, -100000, 100000),
    maxX: number(source.maxX, -100000, 100000),
    maxY: number(source.maxY, -100000, 100000),
  };

  if (result.maxX <= result.minX || result.maxY <= result.minY) {
    throw new Error('The recording contains invalid target bounds.');
  }

  return result;
}

function plan(value: unknown): Plan {
  const source = object(value);
  const count = integer(source.count, 4, 12);

  if (![4, 8, 12].includes(count)) {
    throw new Error('This target count is not supported.');
  }

  const result: Plan = {
    index: integer(source.index, 0, 119),
    seed: integer(source.seed, 0, 1e12),
    count,
    mode: choice(source.mode, ['select', 'free', 'none']),
    layout: choice(source.layout, [
      'grid',
      'scatter',
      'rows',
      'navbar',
      'sidebar',
      'cards',
      'cluster',
    ]),
    intended: nullable(source.intended),
  };

  if (source.phase !== undefined) {
    result.phase = choice(source.phase, ['warmup', 'main']);
    result.approach = choice(source.approach, ['left', 'right', 'top', 'bottom']);
    result.passage = choice(source.passage, ['through', 'above', 'below']);
  }

  if (source.noneVariant !== undefined) {
    result.noneVariant = choice(source.noneVariant, ['gate', 'away']);
  }

  if (source.startKind !== undefined) {
    result.startKind = choice(source.startKind, ['far', 'medium', 'near']);
  }

  return result;
}

function point(value: unknown): Point {
  const source = object(value);

  return { x: number(source.x, -100000, 100000), y: number(source.y, -100000, 100000) };
}

function target(value: unknown): Target {
  const source = object(value);

  return { id: text(source.id, 40), label: text(source.label, 30), rect: rect(source.rect) };
}

function ordered<T>(values: T[], at: (item: T) => number) {
  let previous = -Infinity;

  for (const item of values) {
    const time = at(item);

    if (time < previous) {
      throw new Error('Events must be ordered by delivery time.');
    }

    previous = time;
  }

  return values;
}

function trial(value: unknown): Trial {
  const source = object(value);
  const duration = number(source.duration, 0, 60000);
  const time = (input: unknown) => number(input, 0, duration + 1);
  const targets = array(source.targets, target, 12);
  const ids = new Set(targets.map((item) => item.id));

  const targetId = (input: unknown) => {
    const id = text(input, 40);

    if (!ids.has(id)) {
      throw new Error('An event refers to an unknown target.');
    }

    return id;
  };

  const parsedPlan = plan(source.plan);

  if (targets.length !== parsedPlan.count || ids.size !== targets.length) {
    throw new Error('The target list does not match the trial.');
  }

  if (parsedPlan.intended !== null) {
    targetId(parsedPlan.intended);
  }

  const selected = source.selected === null ? null : targetId(source.selected);
  const outcome = choice(source.outcome, ['selected', 'none', 'timeout', 'interrupted']);

  if ((outcome === 'selected') !== (selected !== null)) {
    throw new Error('The trial outcome does not match the selected target.');
  }

  const samples = ordered(
    array<Sample>(
      source.samples,
      (input) => {
        const item = object(input);

        return {
          x: number(item.x, -100000, 100000),
          y: number(item.y, -100000, 100000),
          timeStamp: number(item.timeStamp, -60000, duration + 1),
          arrivedAt: time(item.arrivedAt),
          batch: integer(item.batch),
          buttons: integer(item.buttons, 0, 31),
        };
      },
      100001,
    ),
    (item) => item.arrivedAt,
  );

  const frames = ordered(
    array<Frame>(source.frames, (input) => {
      const item = object(input);

      return {
        at: time(item.at),
        measuredAt: time(item.measuredAt),
        forecast: array(
          item.forecast,
          (forecastPoint) => {
            const p = object(forecastPoint);

            return {
              x: number(p.x, -1e9, 1e9),
              y: number(p.y, -1e9, 1e9),
              offsetMs: number(p.offsetMs, 0, 10000),
            };
          },
          20,
        ),
        hits: array(
          item.hits,
          (hit) => {
            const h = object(hit);

            return { target: targetId(h.target), etaMs: number(h.etaMs, 0, 10000) };
          },
          12,
        ),
      };
    }),
    (item) => item.at,
  );

  const callbacks = ordered(
    array<Callback>(
      source.callbacks,
      (input) => {
        const item = object(input);

        return {
          target: targetId(item.target),
          at: time(item.at),
          evaluatedAt: time(item.evaluatedAt),
          etaMs: number(item.etaMs, 0, 10000),
        };
      },
      100,
    ),
    (item) => item.at,
  );

  const events = ordered(
    array<TrialEvent>(source.events, (input) => {
      const item = object(input);

      const result: TrialEvent = {
        type: choice(item.type, ['enter', 'leave', 'reset']),
        target: item.target === null ? null : targetId(item.target),
        at: time(item.at),
      };

      if (item.cause !== undefined) {
        result.cause = text(item.cause, 80);
      }

      return result;
    }),
    (item) => item.at,
  );

  const result: Trial = {
    id: text(source.id, 80),
    plan: parsedPlan,
    startedAt: text(source.startedAt, 80),
    timeOrigin: number(source.timeOrigin),
    startTime: number(source.startTime),
    duration,
    board: rect(source.board),
    targets,
    gate: source.gate === null || source.gate === undefined ? null : rect(source.gate),
    gatePassedAt:
      source.gatePassedAt === null || source.gatePassedAt === undefined
        ? null
        : time(source.gatePassedAt),
    samples,
    frames,
    ticks: ordered(array(source.ticks, time), (item) => item),
    callbacks,
    events,
    outcome,
    selected,
    reason: nullable(source.reason),
  };

  if (source.context !== undefined) {
    const context = object(source.context);
    const viewport = object(context.viewport);
    const end = context.end === null ? null : object(context.end);
    result.context = {
      attempt: integer(context.attempt, 1, 2),
      start: point(context.start),
      startRect: rect(context.startRect),
      finishRect: context.finishRect === null ? null : rect(context.finishRect),
      end:
        end === null
          ? null
          : {
              ...point(end),
              at: time(end.at),
              timeStamp: number(end.timeStamp, -60000, duration + 1),
            },
      viewport: {
        width: number(viewport.width, 1, 100000),
        height: number(viewport.height, 1, 100000),
        dpr: number(viewport.dpr, 0.1, 20),
        scrollX: number(viewport.scrollX, -100000, 100000),
        scrollY: number(viewport.scrollY, -100000, 100000),
      },
    };
    result.quality = assessTrial(result);
  }

  return result;
}

function collection(value: unknown): Collection {
  const source = object(value);
  const sessionNumber = integer(source.number, 1, 2);

  if (sessionNumber !== 1 && sessionNumber !== 2) {
    throw new Error('Invalid session number.');
  }

  return {
    studyId: choice(source.studyId, ['intent-5p-v1', 'intent-lib-v1']),
    recordingId: text(source.recordingId, 80),
    number: sessionNumber,
    phase: choice(source.phase, ['instructions', 'warmup', 'main']),
    warmupNext: integer(source.warmupNext, 0, 12),
    acknowledgedBoundary: integer(source.acknowledgedBoundary, 0, 120),
    revision: integer(source.revision),
    exports: array(
      source.exports,
      (input) => {
        const item = object(input);

        return {
          at: text(item.at, 80),
          sha256: text(item.sha256, 64),
          trialCount: integer(item.trialCount, 0, 264),
        };
      },
      1000,
    ),
  };
}

export function readSession(value: unknown): Session {
  const source = object(value);
  const provenance = object(source.provenance);
  const environment = object(source.environment);
  const baseline = object(source.baseline);
  const total = integer(source.total, 12, 120);

  if (![12, 24, 120].includes(total)) {
    throw new Error('This session length is not supported.');
  }

  const trials = array(source.trials, trial, 1000);
  const protocolVersion = source.protocolVersion ?? 1;

  if (
    protocolVersion !== 1 &&
    protocolVersion !== 2 &&
    protocolVersion !== 3 &&
    protocolVersion !== 4
  ) {
    throw new Error('This recording protocol is not supported.');
  }

  if (
    protocolVersion >= 2 &&
    trials.some((item) => {
      const requiresGate = item.plan.mode === 'none' && item.plan.noneVariant !== 'away';

      return (
        requiresGate !== (item.gate !== null) ||
        (item.outcome === 'none' && requiresGate && item.gatePassedAt === null) ||
        (item.gate === null && item.gatePassedAt !== null)
      );
    })
  ) {
    throw new Error('The trial does not match the gate protocol.');
  }

  if (
    new Set(trials.map((item) => item.id)).size !== trials.length ||
    trials.some((item) => item.plan.index >= total)
  ) {
    throw new Error('The session contains an invalid trial list.');
  }

  const result: Session = {
    id: text(source.id, 80),
    protocolVersion,
    createdAt: text(source.createdAt, 80),
    participant: text(source.participant, 80),
    device: choice(source.device, ['mouse', 'trackpad']),
    seed: integer(source.seed, 0, 1e12),
    total,
    nextIndex: integer(source.nextIndex, 0, total),
    provenance: {
      revision: text(provenance.revision, 100),
      sourceHash: text(provenance.sourceHash, 100),
    },
    environment: {
      userAgent: text(environment.userAgent, 1000),
      width: number(environment.width, 1, 100000),
      height: number(environment.height, 1, 100000),
      dpr: number(environment.dpr, 0.1, 20),
      coalesced: boolean(environment.coalesced),
    },
    baseline: {
      horizonMs: number(baseline.horizonMs, 1, 10000),
      stableForMs: number(baseline.stableForMs, 0, 10000),
      maxSampleAgeMs: number(baseline.maxSampleAgeMs, 1, 10000),
      once: boolean(baseline.once),
    },
    trials,
  };

  if (provenance.collectorHash !== undefined) {
    result.provenance.collectorHash = text(provenance.collectorHash, 100);
  }

  if (protocolVersion === 3 || protocolVersion === 4) {
    const isV4 = protocolVersion === 4;
    const allowedParticipants = isV4 ? participants : legacyParticipantsV3;
    const expectedStudyId = isV4 ? STUDY_ID : 'intent-5p-v1';
    const planFn = isV4 ? collectionPlan : legacyCollectionPlanV3;
    result.environment.automated = boolean(environment.automated);
    result.collection = collection(source.collection);

    if (
      !allowedParticipants.includes(result.participant) ||
      result.collection.studyId !== expectedStudyId ||
      total !== 120 ||
      result.provenance.collectorHash === undefined ||
      result.seed !== studySeed(result.participant, result.collection.number)
    ) {
      throw new Error('The session does not match the study protocol.');
    }

    let checked: Session = {
      ...result,
      nextIndex: 0,
      trials: [],
      collection: { ...result.collection, warmupNext: 0 },
    };

    const planKeys = isV4
      ? ([
          'seed',
          'count',
          'mode',
          'layout',
          'intended',
          'approach',
          'passage',
          'noneVariant',
          'startKind',
        ] as const)
      : (['seed', 'count', 'mode', 'layout', 'intended', 'approach', 'passage'] as const);

    for (const item of trials) {
      const phase = item.plan.phase;

      if (
        phase === undefined ||
        item.context === undefined ||
        (phase === 'main' && checked.collection?.warmupNext !== 12) ||
        (phase === 'warmup' &&
          (item.plan.index >= 12 ||
            checked.trials.some((previous) => previous.plan.phase === 'main')))
      ) {
        throw new Error('The trial phase is invalid.');
      }

      const expectedIndex = phase === 'warmup' ? checked.collection?.warmupNext : checked.nextIndex;
      const expectedPlan = planFn(result.seed, item.plan.index, phase);

      const expectedAttempt =
        checked.trials.filter(
          (previous) => previous.plan.phase === phase && previous.plan.index === item.plan.index,
        ).length + 1;

      if (
        item.plan.index !== expectedIndex ||
        item.context.attempt !== expectedAttempt ||
        planKeys.some((key) => item.plan[key] !== expectedPlan[key])
      ) {
        throw new Error('The trial order or plan is invalid.');
      }

      checked = recordCompletion(checked, item);
    }

    const practice = trials.filter(
      (item) => item.plan.phase === 'warmup' && item.quality?.eligible === true,
    );

    if (
      result.collection.phase === 'main' &&
      (practice.length < 8 || !practice.some((item) => item.outcome === 'none'))
    ) {
      throw new Error('Practice has not passed the recording check.');
    }

    if (
      checked.nextIndex !== result.nextIndex ||
      checked.collection?.warmupNext !== result.collection.warmupNext ||
      (result.collection.phase === 'instructions' && trials.length > 0) ||
      (result.collection.phase !== 'main' && trials.some((item) => item.plan.phase === 'main')) ||
      (result.collection.phase === 'main' && result.collection.warmupNext !== 12) ||
      result.baseline.horizonMs !== 160 ||
      result.baseline.stableForMs !== 30 ||
      result.baseline.maxSampleAgeMs !== 100 ||
      !result.baseline.once ||
      result.collection.acknowledgedBoundary % 24 !== 0 ||
      result.collection.acknowledgedBoundary > result.nextIndex ||
      result.collection.exports.some((entry) => entry.trialCount > trials.length)
    ) {
      throw new Error('The saved progress does not match the recordings.');
    }
  }

  return result;
}

export async function importSession(contents: string): Promise<Session> {
  const input: unknown = JSON.parse(contents);
  const source = object(input);

  if (source.schemaVersion === 2) {
    const protocol = text(source.protocol);

    if (
      (protocol !== PROTOCOL && protocol !== 'hasta-intent-5p-v3') ||
      text(source.sha256, 64) !== (await checksum(JSON.stringify(source.session)))
    ) {
      throw new Error('The backup checksum does not match. Choose an unchanged backup.');
    }

    const session = readSession(source.session);
    const expectedVersion = protocol === PROTOCOL ? 4 : 3;

    if (session.protocolVersion !== expectedVersion) {
      throw new Error('The backup protocol does not match.');
    }

    return session;
  }

  if (
    source.schemaVersion !== 1 ||
    !['hasta-intent-pilot-v1', 'hasta-intent-pilot-v2'].includes(text(source.protocol))
  ) {
    throw new Error('Choose a Hasta Lab backup.');
  }

  const session = readSession(source.session);

  if (source.protocol !== `hasta-intent-pilot-v${session.protocolVersion}`) {
    throw new Error('The session protocol does not match the export.');
  }

  return session;
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('hasta-intent-lab', 2);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains('sessions')) {
        request.result.createObjectStore('sessions', { keyPath: 'id' });
      }

      if (!request.result.objectStoreNames.contains('checks')) {
        request.result.createObjectStore('checks');
      }
    });
    request.addEventListener('success', () => resolve(request.result));
    request.addEventListener('error', () =>
      reject(new Error('Local storage is unavailable. Download a backup to keep your recordings.')),
    );
    request.addEventListener('blocked', () =>
      reject(new Error('Close other lab tabs and reload this page.')),
    );
  });
}

export async function loadSessions(): Promise<{ sessions: Session[]; rejected: number }> {
  const db = await database();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readonly');
    const request = transaction.objectStore('sessions').getAll();
    request.addEventListener('success', () => {
      try {
        const value: unknown = request.result;
        let rejected = 0;
        const sessions: Session[] = [];
        array(
          value,
          (item) => {
            try {
              sessions.push(readSession(item));
            } catch {
              rejected++;
            }

            return null;
          },
          1000,
        );
        resolve({
          sessions: sessions.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)),
          rejected,
        });
      } catch {
        reject(new Error('Saved sessions could not be read.'));
      }
    });

    request.addEventListener('error', () => reject(new Error('Saved sessions could not be read.')));
    transaction.addEventListener('complete', () => db.close());
    transaction.addEventListener('abort', () => {
      db.close();
      reject(new Error('Reading saved sessions was interrupted.'));
    });
  });
}

export function journalTrial(sessionId: string, recording: Trial) {
  localStorage.setItem('hasta.lab.pending', JSON.stringify({ sessionId, trial: recording }));
}

export function clearJournal() {
  localStorage.removeItem('hasta.lab.pending');
}

export async function recoverTrial(sessions: Session[]) {
  const contents = localStorage.getItem('hasta.lab.pending');

  if (contents === null) {
    return sessions;
  }

  const input: unknown = JSON.parse(contents);
  const pending = object(input);
  const session = sessions.find((item) => item.id === text(pending.sessionId));

  if (!session) {
    throw new Error(
      'An unfinished recording has no readable session. Contact the coordinator; keep this browser data intact.',
    );
  }

  const unfinished = trial(pending.trial);

  if (session.trials.some((item) => item.id === unfinished.id)) {
    clearJournal();

    return sessions;
  }

  unfinished.reason = 'The page closed during this trial. Partial input could not be recovered.';
  const updated = recordCompletion(session, unfinished);

  if (updated.collection) {
    updated.collection.revision++;
  }

  await saveSession(updated);
  clearJournal();

  return sessions.map((item) => (item.id === updated.id ? updated : item));
}

export async function checkStorage() {
  localStorage.setItem('hasta.lab.check', 'ready');

  if (localStorage.getItem('hasta.lab.check') !== 'ready') {
    throw new Error('Local storage is unavailable.');
  }

  localStorage.removeItem('hasta.lab.check');
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('checks', 'readwrite');
    const store = transaction.objectStore('checks');
    store.put('ready', 'probe');
    const request = store.get('probe');
    request.addEventListener('success', () => {
      if (request.result === 'ready') {
        store.delete('probe');
      } else {
        transaction.abort();
      }
    });
    transaction.addEventListener('complete', () => {
      db.close();
      resolve();
    });
    transaction.addEventListener('abort', () => {
      db.close();
      reject(new Error('Local saving is unavailable. Use a regular browser window and reload.'));
    });
  });
}

export async function saveSession(session: Session): Promise<void> {
  const db = await database();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('sessions', 'readwrite');
    const store = transaction.objectStore('sessions');
    const existing = store.get(session.id);
    existing.addEventListener('success', () => {
      const current: unknown = existing.result;

      if (
        current !== undefined &&
        session.collection &&
        readSession(current).collection?.revision !== session.collection.revision - 1
      ) {
        transaction.abort();
      } else {
        store.put(session);
      }
    });
    transaction.addEventListener('complete', () => {
      db.close();
      resolve();
    });

    transaction.addEventListener('abort', () => {
      db.close();
      reject(new Error('Local saving failed. Download a backup, then retry saving.'));
    });

    transaction.addEventListener('error', () =>
      reject(new Error('Local saving failed. Download a backup, then retry saving.')),
    );
  });
}
