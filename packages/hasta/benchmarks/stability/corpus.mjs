import { firstSegmentRectIntersection } from '../../dist/core/geometry.js';
import { randomSource } from '../comparison/corpus.mjs';

export const HORIZONS = Object.freeze([16, 60, 120, 160]);

export const FAMILIES = Object.freeze([
  'straight',
  'minimum-jerk',
  'turn',
  'reverse',
  'stop-short',
  'hesitate',
  'pass-by',
  'quantized-slow',
]);

export const PROFILES = Object.freeze(['clean', 'sparse', 'batched', 'outliers', 'correlated']);
const BASES = { calibration: 104729, validation: 32452843, test: 49979687 };

function rect(x, y, size) {
  return { minX: x - size / 2, minY: y - size / 2, maxX: x + size / 2, maxY: y + size / 2 };
}

function motion(family, seed) {
  const random = randomSource(seed);

  const speed =
    family === 'quantized-slow' ? 0.035 + random.uniform() * 0.02 : 0.35 + random.uniform() * 0.8;

  const distance = family === 'quantized-slow' ? 28 : 280 + random.uniform() * 180;
  const travelMs = distance / speed;
  const start = { x: 60, y: 180 };
  const destination = { x: start.x + distance, y: start.y };
  const duration = travelMs + 350;
  const point = (x, y = 0) => ({ x: start.x + x, y: start.y + y });

  return {
    duration,
    destination,
    changeAt:
      family === 'stop-short'
        ? (distance - 140) / speed
        : ['turn', 'reverse', 'hesitate'].includes(family)
          ? travelMs * 0.55
          : null,
    position(time) {
      const elapsed = Math.max(0, time);
      const progress = Math.min(1, elapsed / travelMs);

      switch (family) {
        case 'straight':
          return point(Math.min(distance, speed * elapsed));
        case 'quantized-slow':
          return point(Math.min(distance, speed * elapsed));
        case 'minimum-jerk':
          return point(distance * (10 * progress ** 3 - 15 * progress ** 4 + 6 * progress ** 5));
        case 'turn': {
          const x = Math.min(distance, speed * elapsed);

          const y =
            elapsed < travelMs * 0.55 ? 0 : Math.min(110, speed * (elapsed - travelMs * 0.55));

          return point(x, y);
        }

        case 'reverse':
          return point(
            elapsed < travelMs * 0.55
              ? speed * elapsed
              : Math.max(0, distance * 1.1 - speed * elapsed),
          );
        case 'stop-short':
          return point(Math.min(distance - 140, speed * elapsed));
        case 'hesitate': {
          const pauseAt = travelMs * 0.55;
          const active = elapsed <= pauseAt ? elapsed : Math.max(pauseAt, elapsed - 90);

          return point(Math.min(distance, speed * active));
        }

        case 'pass-by':
          return point(Math.min(distance + 180, speed * elapsed), 70);
        default:
          throw new Error(`Unknown motion family: ${family}`);
      }
    },
  };
}

function firstEntry(position, target, duration) {
  let previous = position(0);

  for (let time = 0.5; time <= duration; time += 0.5) {
    const next = position(time);
    const hit = firstSegmentRectIntersection(previous, next, target);

    if (hit !== null) {
      return time - 0.5 + hit.fraction * 0.5;
    }

    previous = next;
  }

  return null;
}

export function createTrace(family, profile, seed, split = 'test') {
  const path = motion(family, seed);
  const random = randomSource(seed ^ 0x4519ad);
  const size = family === 'quantized-slow' ? 8 : [16, 32, 64][seed % 3];

  const destination =
    family === 'turn' ? { ...path.destination, y: path.destination.y + 110 } : path.destination;

  const selected = ['reverse', 'stop-short', 'pass-by'].includes(family) ? null : 'goal';

  const targets = [
    { id: 'goal', rect: rect(destination.x, destination.y, size) },
    {
      id: 'near-route',
      rect: rect(destination.x - (family === 'quantized-slow' ? 20 : 85), destination.y - 50, size),
    },
    { id: 'far-route', rect: rect(destination.x + 85, destination.y + 50, size) },
  ].map((target) =>
    Object.assign(target, {
      entryMs: firstEntry(path.position, target.rect, path.duration),
    }),
  );

  const registration = randomSource(seed ^ 0x671944);

  for (let index = targets.length - 1; index > 0; index--) {
    const other = Math.floor(registration.uniform() * (index + 1));
    [targets[index], targets[other]] = [targets[other], targets[index]];
  }

  const samples = [];
  const cadence = profile === 'sparse' ? 20 : profile === 'batched' ? 1 : 4;
  const noise = profile === 'clean' || profile === 'sparse' ? 0 : 0.35;
  let previous = null;
  let correlatedX = 0;
  let correlatedY = 0;

  for (let time = 0; time <= path.duration; time += cadence) {
    const point = path.position(time);

    const truth =
      family === 'quantized-slow' ? { x: Math.round(point.x), y: Math.round(point.y) } : point;

    // A stopped pointer does not supply independent repeated position observations
    if (previous !== null && truth.x === previous.x && truth.y === previous.y) {
      continue;
    }

    previous = truth;
    const correlation = profile === 'correlated' ? Math.exp(-cadence / 12) : 0;
    correlatedX =
      correlation * correlatedX + noise * Math.sqrt(1 - correlation ** 2) * random.normal();
    correlatedY =
      correlation * correlatedY + noise * Math.sqrt(1 - correlation ** 2) * random.normal();
    const outlier = profile === 'outliers' && random.uniform() < 0.025;

    const sample = {
      x: truth.x + correlatedX + (outlier ? random.normal() * 24 : 0),
      y: truth.y + correlatedY + (outlier ? random.normal() * 24 : 0),
      timeStamp: time,
      arrivedAt: profile === 'batched' ? Math.ceil(time / 16) * 16 + 8 : time,
      buttons: 0,
    };

    samples.push(sample);
  }

  const phase = randomSource(seed ^ 0x334a91).uniform() * (1000 / 60);
  const frames = [];

  for (let time = phase; time <= path.duration; time += 1000 / 60) {
    frames.push(time);
  }

  return {
    id: `${split}/${family}/${profile}/${seed}`,
    block: `${split}/${family}/${seed}`,
    family,
    profile,
    seed,
    split,
    duration: path.duration,
    changeAt: path.changeAt,
    selected,
    cutoff:
      selected === null ? path.duration : targets.find((target) => target.id === selected).entryMs,
    targets,
    samples,
    frames,
    resets: [],
    position: path.position,
    source: 'synthetic',
  };
}

export function createCorpus(split, repeats = 4, seedOffset = 0) {
  const base = BASES[split];

  if (
    base === undefined ||
    !Number.isInteger(repeats) ||
    repeats < 1 ||
    repeats > 1000 ||
    !Number.isSafeInteger(seedOffset) ||
    seedOffset < 0 ||
    base + seedOffset + (FAMILIES.length - 1) * 1009 + (repeats - 1) * 100003 > 0xffff_ffff
  ) {
    throw new Error(
      'Use a named split, 1–1000 repetitions, and an offset keeping all seeds in uint32.',
    );
  }

  return FAMILIES.flatMap((family, familyIndex) =>
    Array.from({ length: repeats }, (_, repeat) =>
      PROFILES.map((profile) =>
        createTrace(
          family,
          profile,
          base + seedOffset + familyIndex * 1009 + repeat * 100003,
          split,
        ),
      ),
    ).flat(),
  );
}
