export const TRAIN_FAMILIES = ['straight', 'accelerate', 'stop', 'turn', 'arc'];
export const OOD_FAMILIES = ['reverse', 'minimum-jerk', 'figure-eight', 'overshoot'];
export const TRAIN_PROFILES = ['clean', 'noisy', 'low-rate', 'irregular'];
export const OOD_PROFILES = ['quantized', 'outliers', 'correlated', 'dropout'];
export const HORIZONS = [16, 60, 120];
export const DURATION_MS = 1500;

export function randomSource(seed) {
  let spare = null;

  const uniform = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return (seed + 0.5) / 2 ** 32;
  };

  return {
    uniform,
    normal() {
      if (spare !== null) {
        const value = spare;
        spare = null;

        return value;
      }

      const radius = Math.sqrt(-2 * Math.log(uniform()));
      const angle = 2 * Math.PI * uniform();
      spare = radius * Math.sin(angle);

      return radius * Math.cos(angle);
    },
  };
}

function trajectory(family, seed) {
  const random = randomSource(seed);
  const speed = 0.2 + random.uniform();
  const radius = 70 + random.uniform() * 150;
  const changeAt = 550 + random.uniform() * 300;
  const angle = random.uniform() * Math.PI * 2;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const phase = random.uniform() * Math.PI;
  const distance = speed * 700;

  const local = (time) => {
    switch (family) {
      case 'straight':
        return [speed * time, 0];
      case 'accelerate':
        return [(speed * time * time) / DURATION_MS, 0];
      case 'stop':
        return [speed * Math.min(time, changeAt), 0];
      case 'turn':
        return [speed * Math.min(time, changeAt), speed * Math.max(0, time - changeAt)];
      case 'reverse':
        return [speed * (time <= changeAt ? time : 2 * changeAt - time), 0];
      case 'arc': {
        const rotation = (speed * time) / radius + phase;

        return [radius * Math.sin(rotation), radius * Math.cos(rotation)];
      }

      case 'minimum-jerk': {
        const progress = Math.max(0, Math.min(1, time / changeAt));
        const eased = 10 * progress ** 3 - 15 * progress ** 4 + 6 * progress ** 5;

        return [distance * eased, 0];
      }

      case 'figure-eight': {
        const rotation = (speed * time) / radius + phase;

        return [radius * Math.sin(rotation), (radius / 2) * Math.sin(2 * rotation)];
      }

      case 'overshoot': {
        if (time <= changeAt) {
          return [speed * time, 0];
        }

        const elapsed = time - changeAt;

        return [
          speed * changeAt + (speed / 0.025) * Math.exp(-elapsed / 120) * Math.sin(0.025 * elapsed),
          0,
        ];
      }

      default:
        throw new Error(`Unknown trajectory ${family}`);
    }
  };

  return {
    changeAt,
    position(time) {
      const [x, y] = local(time);

      return { x: 256 + x * cosine - y * sine, y: 256 + x * sine + y * cosine };
    },
  };
}

function profile(name) {
  const base = {
    sampleMs: 1,
    noiseStd: 0,
    irregular: false,
    coordinateQuantum: 0,
    timeQuantum: 0,
    coalesceMs: 0,
    deliveryDelayMs: 0,
    outlierRate: 0,
    correlated: false,
    correlationMs: 12,
    dropout: false,
  };

  switch (name) {
    case 'clean':
      return base;
    case 'noisy':
      return { ...base, noiseStd: 0.5 };
    case 'low-rate':
      return { ...base, sampleMs: 8, noiseStd: 0.5 };
    case 'irregular':
      return { ...base, noiseStd: 0.25, irregular: true, coalesceMs: 8, deliveryDelayMs: 4 };
    case 'quantized':
      return {
        ...base,
        sampleMs: 0.125,
        noiseStd: 0.1,
        coordinateQuantum: 1,
        timeQuantum: 1,
        coalesceMs: 1000 / 60,
      };
    case 'outliers':
      return { ...base, noiseStd: 0.25, outlierRate: 0.01, coalesceMs: 8 };
    case 'correlated':
      return { ...base, sampleMs: 8, noiseStd: 0.5, correlated: true, coordinateQuantum: 0.25 };
    case 'correlated-fast':
      return { ...base, sampleMs: 1, noiseStd: 0.5, correlated: true, correlationMs: 2 };
    case 'dropout':
      return { ...base, sampleMs: 4, noiseStd: 0.25, dropout: true, deliveryDelayMs: 12 };
    default:
      throw new Error(`Unknown profile ${name}`);
  }
}

export function createTrace(family, profileName, seed, split) {
  const motion = trajectory(family, seed ^ 0x57a38d91);
  const sensor = profile(profileName);
  const random = randomSource(seed ^ 0x93e4f08b);
  const samples = [];
  let correlatedX = 0;
  let correlatedY = 0;
  let previousTime = -sensor.sampleMs;

  for (let time = 0; time <= DURATION_MS;) {
    const dt = time - previousTime;
    previousTime = time;
    const truePosition = motion.position(time);
    const correlation = sensor.correlated ? Math.exp(-dt / sensor.correlationMs) : 0;
    const innovation = sensor.noiseStd * Math.sqrt(1 - correlation * correlation);
    correlatedX = correlation * correlatedX + innovation * random.normal();
    correlatedY = correlation * correlatedY + innovation * random.normal();
    let x = truePosition.x + correlatedX;
    let y = truePosition.y + correlatedY;

    if (random.uniform() < sensor.outlierRate) {
      x += random.normal() * 24;
      y += random.normal() * 24;
    }

    if (sensor.coordinateQuantum !== 0) {
      x = Math.round(x / sensor.coordinateQuantum) * sensor.coordinateQuantum;
      y = Math.round(y / sensor.coordinateQuantum) * sensor.coordinateQuantum;
    }

    const timeStamp =
      sensor.timeQuantum === 0 ? time : Math.floor(time / sensor.timeQuantum) * sensor.timeQuantum;

    const arrivedAt =
      (sensor.coalesceMs === 0 ? time : Math.ceil(time / sensor.coalesceMs) * sensor.coalesceMs) +
      sensor.deliveryDelayMs;

    if (!sensor.dropout || time < 600 || time > 850) {
      samples.push({ x, y, timeStamp, arrivedAt });
    }

    time += sensor.sampleMs * (sensor.irregular ? 0.25 + random.uniform() * 1.5 : 1);
  }

  const targets = [];

  for (const [index, time] of [350, 750, 1150].entries()) {
    const center = motion.position(time);
    const next = motion.position(time + 1);
    const previous = motion.position(time - 1);
    let dx = next.x - previous.x;
    const dy = next.y - previous.y;

    if (dx === 0 && dy === 0) {
      dx = 1;
    }

    const length = Math.hypot(dx, dy) || 1;
    const size = [16, 32, 64][index];

    for (const offset of [0, size + 24]) {
      const x = center.x - (dy / length) * offset;
      const y = center.y + (dx / length) * offset;
      targets.push({
        minX: x - size / 2,
        maxX: x + size / 2,
        minY: y - size / 2,
        maxY: y + size / 2,
      });
    }
  }

  const frames = [];
  const framePhase = randomSource(seed ^ 0xb1d7195).uniform() * (1000 / 60);

  for (let now = framePhase; now <= DURATION_MS; now += 1000 / 60) {
    frames.push(now);
  }

  return {
    id: `${split}/${family}/${profileName}/${seed}`,
    family,
    profile: profileName,
    seed,
    split,
    samples,
    frames,
    targets,
    changeAt: motion.changeAt,
    hasChange: ['stop', 'turn', 'reverse', 'minimum-jerk', 'overshoot'].includes(family),
    position: motion.position,
  };
}

export function createCorpus(split, seeds = 3) {
  const combinations = [];

  if (split === 'train' || split === 'known') {
    for (const family of TRAIN_FAMILIES) {
      for (const sensor of TRAIN_PROFILES) {
        combinations.push([family, sensor]);
      }
    }
  } else if (split === 'motion') {
    for (const family of OOD_FAMILIES) {
      combinations.push([family, 'noisy']);
    }
  } else if (split === 'sensor') {
    for (const family of ['straight', 'turn', 'arc']) {
      for (const sensor of OOD_PROFILES) {
        combinations.push([family, sensor]);
      }
    }
  } else if (split === 'combined') {
    for (const family of OOD_FAMILIES) {
      for (const sensor of OOD_PROFILES) {
        combinations.push([family, sensor]);
      }
    }
  } else {
    throw new Error(`Unknown split ${split}`);
  }

  const base = { train: 0x1357, known: 0x2468, motion: 0x3579, sensor: 0x468a, combined: 0x579b }[
    split
  ];

  return combinations.flatMap(([family, sensor]) =>
    Array.from({ length: seeds }, (_, repeat) =>
      createTrace(
        family,
        sensor,
        base + [...TRAIN_FAMILIES, ...OOD_FAMILIES].indexOf(family) * 101 + repeat * 10007,
        split,
      ),
    ),
  );
}
