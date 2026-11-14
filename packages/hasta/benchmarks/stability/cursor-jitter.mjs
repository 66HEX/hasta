import { KalmanPredictor } from '../../dist/core/index.js';
import {
  IntersectionHysteresis,
  RELEASE_MARGIN_PX,
} from '../../dist/runtime/triggers/intersection-hysteresis.js';
import { Subscription } from '../../dist/runtime/triggers/subscription.js';
import { KalmanPredictor as PreviousPredictor } from './baseline-5cf01cf/core/prediction/kalman-predictor.js';

export { PreviousPredictor, KalmanPredictor };

export function steadyReplay(
  Model,
  {
    seed = 42,
    dt = 8,
    speed = 0.2,
    horizon = 160,
    noise = 0.5,
    quantize = false,
    jitter = false,
    hysteresis = false,
  } = {},
) {
  const predictor = new Model();
  const retention = new IntersectionHysteresis();
  const rect = { minX: speed * 1250, maxX: speed * 1250 + 80, minY: -20, maxY: 20 };

  const releaseRect = Object.fromEntries(
    Object.entries(rect).map(([key, value]) => [
      key,
      value + (key.startsWith('min') ? -RELEASE_MARGIN_PX : RELEASE_MARGIN_PX),
    ]),
  );

  let starts = 0;
  let cancellations = 0;
  let firstStart = null;

  const subscription = new Subscription(
    (event) => {
      starts++;
      firstStart ??= event.now;
      event.signal.addEventListener('abort', () => cancellations++);
    },
    {},
    (error) => {
      throw error;
    },
  );

  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed / 2 ** 32;
  };

  let nextSample = 0;
  let latest;
  let previousEnd = null;
  let backwards = 0;
  let maxBackwards = 0;
  let squaredError = 0;
  let frames = 0;

  for (let frame = 0; frame <= 81; frame++) {
    const now = frame * (1000 / 60);

    while (nextSample <= now) {
      const x = nextSample * speed + (random() * 2 - 1) * noise;
      latest = { x: quantize ? Math.round(x) : x, y: 0, timeStamp: nextSample };
      predictor.update(latest);
      nextSample += dt * (jitter ? 0.75 + random() * 0.5 : 1);
    }

    const forecast = predictor.predict(now, horizon);

    if (forecast === null) {
      continue;
    }

    const end = forecast.points[1].x;

    if (now >= 250) {
      const error = end - (now + horizon) * speed;

      squaredError += error * error;
      frames++;

      if (previousEnd !== null && end < previousEnd) {
        backwards++;
        maxBackwards = Math.max(maxBackwards, previousEnd - end);
      }

      previousEnd = end;
    }

    const contact = latest.x >= rect.minX && latest.x <= rect.maxX;
    const hit = contact || predictor.intersectRect(now, horizon, rect) !== null;

    if (!subscription.latched) {
      retention.reset();
    }

    if (hysteresis) {
      if (hit) {
        retention.match(forecast, contact);
      } else if (
        subscription.latched &&
        retention.retain(now, forecast, predictor.intersectRect(now, horizon, releaseRect) !== null)
      ) {
        continue;
      }
    }

    subscription.evaluate(hit, now, hit ? { now } : null, true, latest.timeStamp, contact)?.();
  }

  return {
    rmse: Math.sqrt(squaredError / frames),
    backwards,
    maxBackwards,
    starts,
    cancellations,
    leadMs: firstStart === null ? null : 1250 - firstStart,
  };
}

export function responseReplay(Model, { dt = 8, speed = 0.2, kind = 'turn' } = {}) {
  const predictor = new Model();
  const change = dt * Math.ceil(400 / dt);

  const [vx, vy] =
    kind === 'turn'
      ? [0, speed]
      : kind === 'brake'
        ? [speed * 0.2, 0]
        : kind === 'reverse'
          ? [-speed, 0]
          : [0, 0];

  const errors = [];

  for (let i = 0; i <= Math.ceil((change + 240) / dt); i++) {
    const timeStamp = i * dt;
    predictor.update({
      timeStamp,
      x: speed * Math.min(timeStamp, change) + vx * Math.max(0, timeStamp - change),
      y: vy * Math.max(0, timeStamp - change),
    });

    if (timeStamp < change) {
      continue;
    }

    const [start, end] = predictor.predict(timeStamp, 160).points;
    errors.push({
      elapsed: timeStamp - change,
      error: Math.hypot((end.x - start.x) / 160 - vx, (end.y - start.y) / 160 - vy) / speed,
    });
  }

  return (
    errors.find((_, index) => errors.slice(index).every(({ error }) => error <= 0.1))?.elapsed ??
    Infinity
  );
}

export function summarizeSteady(Model, options = {}, seeds = 100) {
  const rows = Array.from({ length: seeds }, (_, seed) =>
    steadyReplay(Model, { ...options, seed: seed + 1 }),
  );

  return {
    rmse: Math.sqrt(rows.reduce((sum, row) => sum + row.rmse ** 2, 0) / seeds),
    meanBackwards: rows.reduce((sum, row) => sum + row.backwards, 0) / seeds,
    repeatedStarts: rows.filter((row) => row.starts > 1).length,
    cancellations: rows.reduce((sum, row) => sum + row.cancellations, 0),
    missed: rows.filter((row) => row.starts === 0).length,
    meanLeadMs: rows.reduce((sum, row) => sum + (row.leadMs ?? 0), 0) / seeds,
  };
}

if (import.meta.main) {
  const steady = [];

  for (const dt of [1, 4, 8, 1000 / 60, 33]) {
    for (const profile of ['noise', 'quantized', 'jitter']) {
      const options = {
        dt,
        noise: profile === 'quantized' ? 0 : 0.5,
        quantize: profile === 'quantized',
        jitter: profile === 'jitter',
      };

      steady.push({
        dt,
        profile,
        previous: summarizeSteady(PreviousPredictor, options),
        filtered: summarizeSteady(KalmanPredictor, options),
        retained: summarizeSteady(KalmanPredictor, { ...options, hysteresis: true }),
      });
    }
  }

  const response = [];

  for (const dt of [1, 4, 8, 1000 / 60, 33]) {
    for (const speed of [0.1, 0.2, 1]) {
      for (const kind of ['turn', 'brake', 'stop', 'reverse']) {
        const options = { dt, speed, kind };
        response.push({
          ...options,
          previousMs: responseReplay(PreviousPredictor, options),
          currentMs: responseReplay(KalmanPredictor, options),
        });
      }
    }
  }

  console.log(JSON.stringify({ steady, response }, null, 2));
}
