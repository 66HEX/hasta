import { ConstantVelocityPredictor } from '../dist/core/index.js';

const horizonMs = 60;
const durationMs = 2000;
const evaluationMs = 1000 / 60;
const changeAtMs = 1007;

function randomSource(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

    return seed / 2 ** 32;
  };
}

function position(scenario, time) {
  switch (scenario) {
    case 'stop':
      return { x: Math.min(time, changeAtMs), y: 0 };
    case 'reverse':
      return { x: time <= changeAtMs ? time : 2 * changeAtMs - time, y: 0 };
    case 'turn':
      return { x: Math.min(time, changeAtMs), y: Math.max(0, time - changeAtMs) };
    case 'curve':
      return { x: 100 * Math.sin(time / 100), y: 100 * Math.cos(time / 100) };
    default:
      return { x: time, y: 0 };
  }
}

// Experimental estimators share the production predictor's latest-position anchor
function estimate(samples, method, windowMs) {
  const latest = samples.at(-1);

  if (samples.length < 2) {
    return null;
  }

  if (method === 'window') {
    const cutoff = latest.timeStamp - windowMs;
    let index = samples.findIndex((sample) => sample.timeStamp >= cutoff);
    index = Math.min(index, samples.length - 2);
    const first = samples[index];
    const dt = latest.timeStamp - first.timeStamp;

    return { x: (latest.x - first.x) / dt, y: (latest.y - first.y) / dt };
  }

  const recent = samples.filter((sample) => sample.timeStamp >= latest.timeStamp - windowMs);

  if (recent.length < 2) {
    return estimate(samples, 'window', windowMs);
  }

  let sumTime = 0;
  let sumX = 0;
  let sumY = 0;

  for (const sample of recent) {
    sumTime += sample.timeStamp - latest.timeStamp;
    sumX += sample.x - latest.x;
    sumY += sample.y - latest.y;
  }

  const meanTime = sumTime / recent.length;
  const meanX = sumX / recent.length;
  const meanY = sumY / recent.length;
  let variance = 0;
  let covarianceX = 0;
  let covarianceY = 0;

  for (const sample of recent) {
    const dt = sample.timeStamp - latest.timeStamp - meanTime;
    variance += dt * dt;
    covarianceX += dt * (sample.x - latest.x - meanX);
    covarianceY += dt * (sample.y - latest.y - meanY);
  }

  return { x: covarianceX / variance, y: covarianceY / variance };
}

function measure(scenario, sampleMs, noisePx, quantizePx, jitter, timeQuantumMs) {
  const random = randomSource(0x51ab731);
  const predictor = new ConstantVelocityPredictor();
  const samples = [];

  const errors = new Map(
    ['two-sample', 'window-8', 'window-16', 'regression-8', 'regression-16'].map((name) => [
      name,
      [],
    ]),
  );

  let sampleTime = 0;

  for (let now = evaluationMs; now <= durationMs; now += evaluationMs) {
    while (sampleTime <= now) {
      const point = position(scenario, sampleTime);

      const coordinate = (value) => {
        const noisy = value + (random() * 2 - 1) * noisePx;

        return quantizePx === 0 ? noisy : Math.round(noisy / quantizePx) * quantizePx;
      };

      const sample = {
        x: coordinate(point.x),
        y: coordinate(point.y),
        timeStamp:
          timeQuantumMs === 0 ? sampleTime : Math.floor(sampleTime / timeQuantumMs) * timeQuantumMs,
      };

      if (samples.at(-1)?.timeStamp === sample.timeStamp) {
        samples[samples.length - 1] = sample;
      } else {
        samples.push(sample);
      }

      predictor.update(sample);
      sampleTime += sampleMs * (jitter ? 0.25 + random() * 1.5 : 1);
    }

    const latest = samples.at(-1);
    const expected = position(scenario, now + horizonMs);

    for (const [name, values] of errors) {
      let endpoint;

      if (name === 'two-sample') {
        endpoint = predictor.predict(now, horizonMs)?.points[1];
      } else {
        const [method, window] = name.split('-');
        const velocity = estimate(samples, method, Number(window));

        if (velocity) {
          const time = now - latest.timeStamp + horizonMs;
          endpoint = { x: latest.x + velocity.x * time, y: latest.y + velocity.y * time };
        }
      }

      if (endpoint) {
        values.push({
          time: now,
          error: Math.hypot(endpoint.x - expected.x, endpoint.y - expected.y),
        });
      }
    }

    while (samples.length > 2 && samples[1].timeStamp < now - 32) {
      samples.shift();
    }
  }

  const metrics = {};

  for (const [name, values] of errors) {
    const sorted = values.map((value) => value.error).toSorted((a, b) => a - b);

    const transition = values.filter(
      (value) => value.time >= changeAtMs && value.time <= changeAtMs + 32,
    );

    metrics[name] = {
      meanErrorPx: Number(
        (sorted.reduce((sum, error) => sum + error, 0) / sorted.length).toFixed(3),
      ),
      p95ErrorPx: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(3)),
      transitionPeakPx: Number(Math.max(...transition.map((value) => value.error)).toFixed(3)),
    };
  }

  return { scenario, sampleMs, noisePx, quantizePx, jitter, timeQuantumMs, metrics };
}

const results = [];

for (const scenario of ['straight', 'stop', 'reverse', 'turn', 'curve']) {
  for (const sampleMs of [0.125, 0.5, 1, 4, 8, 16]) {
    for (const [noisePx, quantizePx] of [
      [0, 0],
      [0.25, 0],
      [0, 1],
    ]) {
      for (const jitter of [false, true]) {
        for (const timeQuantumMs of [0, 1]) {
          results.push(measure(scenario, sampleMs, noisePx, quantizePx, jitter, timeQuantumMs));
        }
      }
    }
  }
}

console.log(
  JSON.stringify({ horizonMs, durationMs, evaluationMs, seed: '0x51ab731', results }, null, 2),
);
