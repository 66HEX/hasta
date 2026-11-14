import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { importSession } from '../../../../apps/lab/src/data.ts';

export function tracesFromSessions(sessions) {
  return sessions.flatMap((session) =>
    session.trials.flatMap((trial) => {
      if (
        trial.plan.phase !== 'main' ||
        trial.quality?.eligible !== true ||
        !['selected', 'none'].includes(trial.outcome)
      ) {
        return [];
      }

      const targets = trial.targets.map((target) => ({
        ...target,
        entryMs:
          trial.events.find((event) => event.type === 'enter' && event.target === target.id)?.at ??
          null,
      }));

      const entry = targets.find((target) => target.id === trial.selected)?.entryMs;

      if (trial.selected !== null && (entry === null || entry === undefined)) {
        return [];
      }

      return [
        {
          id: `${session.collection.recordingId}/${trial.id}`,
          block: session.participant,
          participant: session.participant,
          session: session.collection.number,
          device: session.device,
          family: trial.plan.mode,
          profile: session.device,
          duration: trial.duration,
          selected: trial.selected,
          cutoff: trial.selected === null ? trial.duration : entry,
          targets,
          samples: trial.samples,
          frames: trial.ticks,
          resets: trial.events.filter((event) => event.type === 'reset'),
          source: session.environment.automated ? 'automated-browser' : 'human',
          sourceTrial: trial,
          attempt: trial.context.attempt,
        },
      ];
    }),
  );
}

export async function loadLabTraces(paths, { allowAutomated = false } = {}) {
  if (paths.length === 0) {
    throw new Error('At least one raw lab backup is required.');
  }

  const limit = 256 * 1024 * 1024;
  const recordings = new Map();
  const sources = [];

  for (const file of paths) {
    const bytes = await readFile(file);

    if (bytes.length > limit) {
      throw new Error(`Backup exceeds 256 MiB: ${file}`);
    }

    const json =
      bytes[0] === 0x1f && bytes[1] === 0x8b
        ? gunzipSync(bytes, { maxOutputLength: limit }).toString('utf8')
        : bytes.toString('utf8');

    const session = await importSession(json);

    if (session.protocolVersion !== 3 || !session.collection) {
      throw new Error(`Protocol 3 collection backup required: ${file}`);
    }

    if (session.environment.automated && !allowAutomated) {
      throw new Error(
        `Automated recording requires --allow-automated and cannot establish human accuracy: ${file}`,
      );
    }

    const previous = recordings.get(session.collection.recordingId);

    if (previous) {
      const [longer, shorter] =
        previous.trials.length >= session.trials.length ? [previous, session] : [session, previous];

      if (
        previous.participant !== session.participant ||
        previous.device !== session.device ||
        previous.collection.number !== session.collection.number ||
        JSON.stringify(previous.provenance) !== JSON.stringify(session.provenance) ||
        JSON.stringify(longer.trials.slice(0, shorter.trials.length)) !==
          JSON.stringify(shorter.trials)
      ) {
        throw new Error(`Conflicting checkpoints for ${session.collection.recordingId}`);
      }

      recordings.set(session.collection.recordingId, longer);
    } else {
      recordings.set(session.collection.recordingId, session);
    }

    sources.push({ path: resolve(file), sha256: createHash('sha256').update(json).digest('hex') });
  }

  const sessions = [...recordings.values()];

  const builds = new Set(
    sessions.map(
      (session) => `${session.provenance.sourceHash}/${session.provenance.collectorHash}`,
    ),
  );

  const slots = new Set();
  const devices = new Map();

  if (builds.size !== 1) {
    throw new Error('Mixed collector builds require separate evaluations.');
  }

  for (const session of sessions) {
    const slot = `${session.participant}/${session.collection.number}`;

    if (slots.has(slot)) {
      throw new Error(`Multiple recordings for ${slot}; choose one explicitly.`);
    }

    if (devices.has(session.participant) && devices.get(session.participant) !== session.device) {
      throw new Error(`${session.participant} changed devices between sessions.`);
    }

    slots.add(slot);
    devices.set(session.participant, session.device);
  }

  const traces = tracesFromSessions(sessions);

  const main = sessions.flatMap((session) =>
    session.trials.filter((trial) => trial.plan.phase === 'main'),
  );

  const eligible = main.filter(
    (trial) => trial.quality?.eligible === true && ['selected', 'none'].includes(trial.outcome),
  );

  return {
    sessions,
    traces,
    sources,
    counts: {
      mainTrials: main.length,
      eligibleResolvedTrials: eligible.length,
      replayedTrials: traces.length,
      excludedMissingEntry: eligible.length - traces.length,
    },
  };
}
