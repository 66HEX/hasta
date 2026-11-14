/* oxlint-disable eslint/no-await-in-loop -- Decode large backups sequentially to bound memory usage. */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';

import { checksum } from '../src/checksum.ts';
import { importSession } from '../src/data.ts';
import { examplesFor, FEATURE_VERSION } from '../src/features.ts';
import { counts, participants } from '../src/protocol.ts';

const baseline = (trials) => {
  let correct = 0;
  let wrong = 0;
  let abstained = 0;
  const leadMs = [];

  for (const trial of trials) {
    const cutoff =
      trial.selected === null
        ? trial.duration
        : (trial.events.find((event) => event.type === 'enter' && event.target === trial.selected)
            ?.at ?? trial.duration);

    const callback = trial.callbacks.find((item) => item.at < cutoff);

    if (!callback) {
      abstained++;
      continue;
    }

    if (trial.selected !== null && callback.target === trial.selected) {
      correct++;
      leadMs.push(cutoff - callback.at);
    } else {
      wrong++;
    }
  }

  return {
    trials: trials.length,
    correct,
    wrong,
    abstained,
    wrongPer100: trials.length > 0 ? (100 * wrong) / trials.length : null,
    leadMs,
  };
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    'allow-automated': { type: 'boolean', default: false },
    'require-complete': { type: 'boolean', default: false },
  },
});

if (!values.out || positionals.length === 0) {
  throw new Error(
    'Usage: node apps/lab/scripts/prepare.mjs --out DIRECTORY [--require-complete] [--allow-automated] BACKUP...',
  );
}

const limit = 256 * 1024 * 1024;
const recordings = new Map();
const sources = [];

for (const file of positionals) {
  const bytes = await readFile(file);

  if (bytes.length > limit) {
    throw new Error(`File exceeds 256 MiB: ${file}`);
  }

  const json =
    bytes[0] === 0x1f && bytes[1] === 0x8b
      ? gunzipSync(bytes, { maxOutputLength: limit }).toString('utf8')
      : bytes.toString('utf8');

  const session = await importSession(json);

  if (session.protocolVersion !== 3 || !session.collection) {
    throw new Error(`Earlier protocol: ${file}`);
  }

  if (session.environment.automated && !values['allow-automated']) {
    throw new Error(
      `Automated recording excluded: ${file}. Only use --allow-automated for a pipeline smoke test.`,
    );
  }

  sources.push({
    file: resolve(file),
    sha256: await checksum(json),
    recordingId: session.collection.recordingId,
  });
  const previous = recordings.get(session.collection.recordingId);

  if (previous) {
    const longer = previous.trials.length > session.trials.length ? previous : session;
    const shorter = longer === previous ? session : previous;

    if (
      previous.participant !== session.participant ||
      previous.collection.number !== session.collection.number ||
      previous.device !== session.device ||
      JSON.stringify(previous.provenance) !== JSON.stringify(session.provenance) ||
      JSON.stringify(longer.trials.slice(0, shorter.trials.length)) !==
        JSON.stringify(shorter.trials)
    ) {
      throw new Error(`Conflicting copies of recording ${session.collection.recordingId}`);
    }

    recordings.set(session.collection.recordingId, longer);
  } else {
    recordings.set(session.collection.recordingId, session);
  }
}

const sessions = [...recordings.values()];

const hashes = new Set(
  sessions.map((session) => `${session.provenance.sourceHash}/${session.provenance.collectorHash}`),
);

if (hashes.size !== 1) {
  throw new Error('Mixed collector or Hasta builds. Keep these datasets separate.');
}

const slots = new Set();
const deviceByParticipant = new Map();

for (const session of sessions.filter((item) => item.nextIndex > 0)) {
  const slot = `${session.participant}/${session.collection.number}`;

  if (slots.has(slot)) {
    throw new Error(
      `Multiple recordings for ${slot}; choose the intended recording before preparing data.`,
    );
  }

  slots.add(slot);
  const device = deviceByParticipant.get(session.participant);

  if (device && device !== session.device) {
    throw new Error(`${session.participant} changed input devices between sessions.`);
  }

  deviceByParticipant.set(session.participant, session.device);
}

const reports = [];
const examples = [];

for (const session of sessions) {
  const main = session.trials.filter((trial) => trial.plan.phase === 'main');
  const usable = main.filter((trial) => trial.quality.eligible);
  const empty = [];
  const firstAttempt = main.filter((trial) => trial.context.attempt === 1);

  for (const trial of usable) {
    const rows = examplesFor(trial);

    if (rows.length === 0) {
      empty.push(trial.id);
    }

    for (const row of rows) {
      examples.push({
        participant: session.participant,
        session: session.collection.number,
        device: session.device,
        trialId: trial.id,
        attempt: trial.context.attempt,
        ...row,
      });
    }
  }

  reports.push({
    participant: session.participant,
    session: session.collection.number,
    device: session.device,
    recordingId: session.collection.recordingId,
    automated: session.environment.automated,
    plannedCompleted: session.nextIndex,
    ...counts(session),
    warmupAttempts: session.trials.length - main.length,
    noFeatureHistory: empty,
    flags: main.flatMap((trial) =>
      trial.quality.flags.map((flag) => ({ trialId: trial.id, flag })),
    ),
    outcomes: Object.fromEntries(
      ['selected', 'none', 'interrupted', 'timeout'].map((outcome) => [
        outcome,
        main.filter((trial) => trial.outcome === outcome).length,
      ]),
    ),
    conditions: [4, 8, 12].map((count) => ({
      count,
      selected: usable.filter((trial) => trial.plan.count === count && trial.selected !== null)
        .length,
      none: usable.filter((trial) => trial.plan.count === count && trial.selected === null).length,
    })),
    baselineEligible: baseline(usable),
    baselineEligibleFirstAttempts: baseline(firstAttempt.filter((trial) => trial.quality.eligible)),
    unresolvedFirstAttempts: firstAttempt.filter((trial) =>
      ['interrupted', 'timeout'].includes(trial.outcome),
    ).length,
  });
}

const missing = participants.flatMap((participant) =>
  [1, 2].flatMap((number) =>
    reports.some(
      (item) =>
        item.participant === participant &&
        item.session === number &&
        item.plannedCompleted === 120,
    )
      ? []
      : [`${participant}/${number}`],
  ),
);

if (values['require-complete'] && missing.length > 0) {
  throw new Error(`Incomplete study: ${missing.join(', ')}`);
}

const report = {
  featureVersion: FEATURE_VERSION,
  protocol: 'hasta-intent-5p-v3',
  build: sessions[0].provenance,
  automated: sessions.some((item) => item.environment.automated),
  sources,
  sessions: reports,
  missing,
  exampleCount: examples.length,
  trialCount: new Set(examples.map((item) => item.trialId)).size,
  baselinePolicy:
    'First callback delivered before first hover of the selected target, or before the end for none. All callbacks remain in the raw backups.',
  folds: participants.map((test) => ({
    test,
    train: participants.filter((id) => id !== test),
    validation: 'Choose inner held-out participants from train; never tune on test.',
  })),
};

await mkdir(values.out, { recursive: true });

await writeFile(
  join(values.out, 'examples.jsonl'),
  examples.map((item) => JSON.stringify(item)).join('\n') + '\n',
  { flag: 'wx' },
);

await writeFile(join(values.out, 'manifest.json'), JSON.stringify(report, null, 2) + '\n', {
  flag: 'wx',
});

console.log(
  JSON.stringify(
    { sessions: reports.length, examples: examples.length, missing, output: resolve(values.out) },
    null,
    2,
  ),
);
