import { HORIZONS } from './corpus.mjs';
import { createModel } from './models.mjs';

function segmentFraction(start, end, rect) {
  let low = 0;
  let high = 1;

  for (const [position, delta, min, max] of [
    [start.x, end.x - start.x, rect.minX, rect.maxX],
    [start.y, end.y - start.y, rect.minY, rect.maxY],
  ]) {
    if (delta === 0) {
      if (position < min || position > max) {
        return null;
      }

      continue;
    }

    const a = (min - position) / delta;
    const b = (max - position) / delta;
    low = Math.max(low, Math.min(a, b));
    high = Math.min(high, Math.max(a, b));

    if (low > high) {
      return null;
    }
  }

  return low;
}

function futureHits(trace, now, stepMs) {
  const hits = trace.targets.map(() => null);
  let previous = trace.position(now);
  let previousTime = now;

  for (let time = now; time <= now + 120; time = Math.min(time + stepMs, now + 120)) {
    const point = trace.position(time);

    for (const [index, rect] of trace.targets.entries()) {
      if (hits[index] !== null) {
        continue;
      }

      const fraction = segmentFraction(previous, point, rect);

      if (fraction !== null) {
        hits[index] = previousTime - now + fraction * (time - previousTime);
      }
    }

    if (time === now + 120) {
      break;
    }

    previous = point;
    previousTime = time;
  }

  return hits;
}

export function prepareTrace(trace, stepMs = 0.5) {
  return {
    ...trace,
    frames: trace.frames.map((now) => ({
      now,
      expected: HORIZONS.map((horizon) => trace.position(now + horizon)),
      hits: stepMs === 0 ? [] : futureHits(trace, now, stepMs),
    })),
  };
}

export function summarize(values) {
  if (values.length === 0) {
    return { count: 0, mean: null, rmse: null, p95: null, max: null };
  }

  const sorted = values.toSorted((a, b) => a - b);
  let total = 0;
  let squares = 0;

  for (const value of values) {
    total += value;
    squares += value * value;
  }

  return {
    count: values.length,
    mean: total / values.length,
    rmse: Math.sqrt(squares / values.length),
    p95: sorted[Math.floor((sorted.length - 1) * 0.95)],
    max: sorted.at(-1),
  };
}

export function evaluateTrace(
  trace,
  config,
  algorithmSeed,
  detailed = true,
  factory = createModel,
) {
  const model = factory(config, algorithmSeed);
  const errors = HORIZONS.map(() => []);
  const postChange = HORIZONS.map(() => []);
  const etaErrors = [];
  const arrivalChanges = [];
  const previousHits = HORIZONS.map(() => trace.targets.map(() => null));
  const confusion = HORIZONS.map(() => ({ tp: 0, fp: 0, fn: 0, tn: 0 }));
  let index = 0;
  let latestTime = null;
  let distinct = 0;
  let eligibleFrames = 0;
  let availableFrames = 0;
  let invalidForecasts = 0;
  let predictionFlips = 0;
  let truthFlips = 0;
  let deliveredSamples = 0;

  for (const frame of trace.frames) {
    const { now } = frame;

    while (index < trace.samples.length && trace.samples[index].arrivedAt <= now) {
      const sample = trace.samples[index++];

      if (
        sample.timeStamp > sample.arrivedAt ||
        sample.arrivedAt - sample.timeStamp >= 100 ||
        (latestTime !== null && sample.timeStamp < latestTime)
      ) {
        continue;
      }

      if (latestTime !== null && sample.timeStamp - latestTime >= 100) {
        distinct = 0;
      }

      if (sample.timeStamp !== latestTime) {
        distinct++;
      }

      latestTime = sample.timeStamp;
      model.update(sample);
      deliveredSamples++;
    }

    if (latestTime === null || now - latestTime >= 100) {
      model.reset();
      latestTime = null;
      distinct = 0;
    }

    if (distinct < 2) {
      for (const previous of previousHits) {
        previous.fill(null);
      }

      continue;
    }

    eligibleFrames++;
    let frameAvailable = true;

    for (const [horizonIndex, horizon] of HORIZONS.entries()) {
      const forecast = model.predict(now, horizon);

      const finite = forecast?.points.every(
        (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
      );

      const available = forecast !== null && finite;

      if (available) {
        const end = forecast.points.at(-1);
        const expected = frame.expected[horizonIndex];
        const error = Math.hypot(end.x - expected.x, end.y - expected.y);
        errors[horizonIndex].push(error);

        if (trace.hasChange && now >= trace.changeAt && now <= trace.changeAt + 32) {
          postChange[horizonIndex].push(error);
        }
      } else {
        frameAvailable = false;
        invalidForecasts++;
      }

      if (!detailed) {
        continue;
      }

      for (const [targetIndex, rect] of trace.targets.entries()) {
        const actualEta = frame.hits[targetIndex];
        const actualHit = actualEta !== null && actualEta <= horizon;

        // Current contact is excluded so stationary targets cannot dominate forecast quality
        if (actualEta === 0) {
          previousHits[horizonIndex][targetIndex] = null;
          continue;
        }

        const fraction = available
          ? segmentFraction(forecast.points[0], forecast.points[1], rect)
          : null;

        const predictedEta = fraction === null ? null : fraction * horizon;
        const predictedHit = predictedEta !== null;
        const cell = confusion[horizonIndex];

        if (predictedHit) {
          cell[actualHit ? 'tp' : 'fp']++;
        } else {
          cell[actualHit ? 'fn' : 'tn']++;
        }

        const previous = previousHits[horizonIndex][targetIndex];

        if (previous !== null) {
          predictionFlips += Number(previous.predictedHit !== predictedHit);
          truthFlips += Number(previous.actualHit !== actualHit);
        }

        if (actualHit && predictedHit && horizon === 120) {
          etaErrors.push(Math.abs(predictedEta - actualEta));

          if (
            previous?.predictedHit &&
            previous.actualHit &&
            previous.predictedEta > 0 &&
            predictedEta > 0 &&
            Math.abs(previous.now + previous.actualEta - now - actualEta) < 2
          ) {
            arrivalChanges.push(
              Math.abs(now + predictedEta - previous.now - previous.predictedEta),
            );
          }
        }

        previousHits[horizonIndex][targetIndex] = {
          now,
          predictedHit,
          actualHit,
          actualEta,
          predictedEta,
        };
      }
    }

    availableFrames += Number(frameAvailable);
  }

  return {
    traceId: trace.id,
    family: trace.family,
    profile: trace.profile,
    seed: trace.seed,
    split: trace.split,
    algorithmSeed,
    deliveredSamples,
    eligibleFrames,
    totalFrames: trace.frames.length,
    availableFrames,
    invalidForecasts,
    accuracy: HORIZONS.map((horizon, horizonIndex) =>
      Object.assign({ horizon }, summarize(errors[horizonIndex])),
    ),
    postChange: HORIZONS.map((horizon, horizonIndex) =>
      Object.assign({ horizon }, summarize(postChange[horizonIndex])),
    ),
    etaError: summarize(etaErrors),
    etaHorizonMs: 120,
    arrivalJitter: summarize(arrivalChanges),
    confusion,
    predictionFlips,
    truthFlips,
  };
}
