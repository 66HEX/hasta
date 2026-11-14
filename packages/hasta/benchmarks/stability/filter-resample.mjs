import { randomSource } from '../comparison/corpus.mjs';
import { createCorpus } from './corpus.mjs';
import { precisionTraces, precisionReport } from './filter-scenarios.mjs';

export function resampleTrace(source, position, cadence, jitter, profile, seed) {
  const random = randomSource(seed ^ 0x4ad563b1);
  const clock = randomSource(seed ^ 0x7a2e48d9);
  const faults = randomSource(seed ^ 0x137e9ba2);
  const samples = [];
  let previous = null;
  let nextFault = source.samples[0].timeStamp + 80 + 160 * faults.uniform();

  for (
    let time = source.samples[0].timeStamp;
    time <= source.frames.at(-1);
    time += cadence * (jitter ? 0.65 + 0.7 * clock.uniform() : 1)
  ) {
    const point = position(time);
    let faultX = 0;
    let faultY = 0;

    while (nextFault <= time) {
      faultX = faults.normal() * 24;
      faultY = faults.normal() * 24;
      nextFault += 80 + 160 * faults.uniform();
    }

    const truth =
      source.family === 'quantized-slow'
        ? { x: Math.round(point.x), y: Math.round(point.y) }
        : point;

    if (previous !== null && truth.x === previous.x && truth.y === previous.y) {
      continue;
    }

    previous = truth;
    const spike = profile === 'spikes' && random.uniform() < 0.025;
    const noise = profile === 'clean' ? 0 : 0.35;

    samples.push({
      x:
        truth.x +
        noise * random.normal() +
        (spike ? 24 * random.normal() : 0) +
        (profile === 'timed-spikes' ? faultX : 0),
      y:
        truth.y +
        noise * random.normal() +
        (spike ? 24 * random.normal() : 0) +
        (profile === 'timed-spikes' ? faultY : 0),
      timeStamp: time,
      arrivedAt: time,
      buttons: 0,
    });
  }

  return {
    ...source,
    id: `${source.id}/${cadence}/${jitter}/${profile}`,
    profile,
    cadence,
    jitter,
    samples,
  };
}

export function* balancedCorpus(split, repeats, seedOffset, cadences) {
  const base = createCorpus(split, repeats, seedOffset).filter(
    (trace) => trace.profile === 'clean',
  );

  for (const trace of base) {
    for (const cadence of cadences) {
      for (const jitter of [false, true]) {
        for (const profile of ['clean', 'noisy', 'timed-spikes']) {
          yield resampleTrace(trace, trace.position, cadence, jitter, profile, trace.seed);
        }
      }
    }
  }
}

export function cadencePrecision(factories, cadences) {
  const precision = [];

  for (const cadence of cadences) {
    for (const jitter of [false, true]) {
      const traces = precisionTraces()
        .filter((trace) => trace.profile === 'direct')
        .map((trace) => {
          const position = (time) => {
            const after = trace.samples.findIndex((sample) => sample.timeStamp >= time);

            if (after <= 0) {
              return after === 0 ? trace.samples[0] : trace.samples.at(-1);
            }

            const previous = trace.samples[after - 1];
            const next = trace.samples[after];
            const fraction = (time - previous.timeStamp) / (next.timeStamp - previous.timeStamp);

            return {
              x: previous.x + fraction * (next.x - previous.x),
              y: previous.y + fraction * (next.y - previous.y),
            };
          };

          const sampled = resampleTrace(trace, position, cadence, jitter, 'clean', 75431);

          sampled.id = trace.id;

          return sampled;
        });

      const control = precisionReport(factories.control, traces);
      const candidate = precisionReport(factories.candidate, traces);

      for (const [index, before] of control.scenarios.entries()) {
        const after = candidate.scenarios[index];

        const phases =
          before.id === 'narrow-channel'
            ? [
                ['initial-right', 'right', 1000, 1030],
                ['down', 'down', 1030, 1062],
                ['reapproach', 'right', 1070, 1112],
              ]
            : [
                ['initial', 'target', 1000, 1040],
                ['reapproach', 'target', 1050, 1060],
              ];

        const phasesCompared = phases.map(([phase, target, from, until]) => {
          const match = (episodes) =>
            episodes.find(
              (episode) => episode.target === target && episode.at >= from && episode.at <= until,
            );

          const original = match(before.episodes);
          const updated = match(after.episodes);

          const turnAt =
            phase === 'down'
              ? 1020
              : phase === 'reapproach'
                ? before.id === 'narrow-channel'
                  ? 1070
                  : 1050
                : null;

          const axis = phase === 'down' ? 'y' : 'x';

          const observedTurn =
            turnAt === null
              ? undefined
              : traces[index].samples.find(
                  (sample, sampleIndex, samples) =>
                    sampleIndex > 0 &&
                    sample.timeStamp > turnAt &&
                    sample[axis] > samples[sampleIndex - 1][axis],
                );

          return {
            phase,
            target,
            deadline: until,
            baselineAt: original?.at ?? null,
            candidateAt: updated?.at ?? null,
            firstObservedTurnAt: observedTurn?.timeStamp ?? null,
            baselineResponseMs:
              observedTurn === undefined || original === undefined
                ? null
                : original.at - observedTurn.timeStamp,
            candidateResponseMs:
              observedTurn === undefined || updated === undefined
                ? null
                : updated.at - observedTurn.timeStamp,
            regression: original !== undefined && updated === undefined,
          };
        });

        const wrongLaneRegression =
          !before.episodes.some((episode) => episode.target === 'diagonal') &&
          after.episodes.some((episode) => episode.target === 'diagonal');

        precision.push({
          cadence,
          jitter,
          id: before.id,
          baselinePasses: before.passes,
          candidatePasses: after.passes,
          regression: wrongLaneRegression || phasesCompared.some((phase) => phase.regression),
          phases: phasesCompared,
          wrongLaneRegression,
          control: before.episodes,
          candidate: after.episodes,
        });
      }
    }
  }

  return precision;
}
