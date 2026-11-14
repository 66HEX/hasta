import { KalmanPredictor } from '../../dist/core/prediction/kalman-predictor.js';
import { Subscription } from '../../dist/runtime/triggers/subscription.js';
import { KalmanPredictor as FrozenPredictor } from './baseline-fa9ac8d/core/prediction/kalman-predictor.js';
import { Subscription as FrozenSubscription } from './baseline-fa9ac8d/runtime/triggers/subscription.js';
import { HORIZONS } from './corpus.mjs';
import { KalmanPredictor as ExperimentalPredictor } from './experimental/core/prediction/kalman-predictor.js';

const mean = (values) =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

function inside(point, rect) {
  return (
    point !== null &&
    point.x >= rect.minX &&
    point.x <= rect.maxX &&
    point.y >= rect.minY &&
    point.y <= rect.maxY
  );
}

export function summarize(values) {
  if (values.length === 0) {
    return { count: 0, mean: null, median: null, p95: null };
  }

  const ordered = values.toSorted((a, b) => a - b);

  return {
    count: values.length,
    mean: mean(values),
    median: ordered[Math.floor((ordered.length - 1) / 2)],
    p95: ordered[Math.floor((ordered.length - 1) * 0.95)],
  };
}

export function isExperimental(name) {
  return name === 'experimental-robust' || name === 'experimental-adaptive';
}

export function createModel(name) {
  if (name === 'frozen') {
    return new FrozenPredictor();
  }

  if (name === 'current') {
    return new KalmanPredictor();
  }

  if (isExperimental(name)) {
    return new ExperimentalPredictor({ mode: name.slice('experimental-'.length) });
  }

  throw new Error(`Unknown benchmark model: ${name}`);
}

export function replayTrace(trace, name, factory = createModel) {
  const model = factory(name);
  const frames = [];
  const errors = [];
  let index = 0;
  let resetIndex = 0;
  let generation = 0;
  let latest = null;
  let resetAtLast = -Infinity;
  let distinct = 0;

  for (const now of trace.frames) {
    while (index < trace.samples.length || resetIndex < trace.resets.length) {
      const sample = trace.samples[index];
      const reset = trace.resets[resetIndex];
      const sampleAt = sample?.arrivedAt ?? Infinity;
      const resetAt = reset?.at ?? Infinity;

      if (Math.min(sampleAt, resetAt) > now) {
        break;
      }

      if (resetAt <= sampleAt) {
        model.reset();
        latest = null;
        distinct = 0;
        generation++;
        resetAtLast = resetAt;
        resetIndex++;
        continue;
      }

      index++;

      if (
        sample.arrivedAt <= resetAtLast ||
        sample.buttons !== 0 ||
        sample.timeStamp > sample.arrivedAt ||
        sample.arrivedAt - sample.timeStamp >= 100 ||
        (latest !== null && sample.timeStamp < latest.timeStamp)
      ) {
        continue;
      }

      if (latest !== null && sample.timeStamp - latest.timeStamp >= 100) {
        model.reset();
        generation++;
        distinct = 0;
      }

      if (latest === null || sample.timeStamp !== latest.timeStamp) {
        distinct++;
      }

      model.update(sample);
      latest = sample;
    }

    if (latest !== null && now - latest.timeStamp >= 100) {
      model.reset();
      latest = null;
      distinct = 0;
      generation++;
    }

    const fresh = latest !== null && now >= latest.timeStamp && now - latest.timeStamp < 100;
    const forecasts = {};

    for (const horizon of HORIZONS) {
      const forecast = fresh ? model.predict(now, horizon) : null;
      const hits = {};

      if (forecast !== null) {
        const start = forecast.points[0];
        const end = forecast.points.at(-1);

        const pathBounds = {
          minX: Math.min(latest.x, start.x, end.x),
          minY: Math.min(latest.y, start.y, end.y),
          maxX: Math.max(latest.x, start.x, end.x),
          maxY: Math.max(latest.y, start.y, end.y),
        };

        const padding =
          Math.max(1, ...Object.values(pathBounds).map((value) => Math.abs(value))) *
          4 *
          Number.EPSILON;

        for (const target of trace.targets) {
          const hit = model.intersectRect(now, horizon, target.rect);
          const age = now - latest.timeStamp;

          const crossed =
            age > 0 && model.intersectRect(latest.timeStamp, age, target.rect) !== null;

          const uncertainty =
            !isExperimental(name) || hit === null ? null : model.uncertainty(now, hit.offsetMs);

          hits[target.id] = {
            etaMs: hit?.offsetMs ?? null,
            stdPx: uncertainty?.positionStdPx ?? null,
            stdNowPx: isExperimental(name)
              ? (model.uncertainty(now, 0)?.positionStdPx ?? null)
              : null,
            contact: inside(latest, target.rect),
            crossed,
            candidate:
              target.rect.maxX >= pathBounds.minX - padding &&
              target.rect.minX <= pathBounds.maxX + padding &&
              target.rect.maxY >= pathBounds.minY - padding &&
              target.rect.minY <= pathBounds.maxY + padding,
          };
        }

        if (trace.position) {
          const endpoint = forecast.points.at(-1);
          const truth = trace.position(now + horizon);
          const errorSquared = (endpoint.x - truth.x) ** 2 + (endpoint.y - truth.y) ** 2;
          const uncertainty = isExperimental(name) ? model.uncertainty(now, horizon) : null;
          errors.push({
            horizon,
            errorPx: Math.sqrt(errorSquared),
            errorSquared,
            variance: uncertainty?.positionVariancePx2 ?? null,
            postChange:
              trace.changeAt !== null && now >= trace.changeAt && now < trace.changeAt + 32,
          });
        }
      }

      forecasts[horizon] = forecast === null ? null : hits;
    }

    frames.push({
      now,
      generation,
      evidenceTime: latest?.timeStamp ?? null,
      eligible: fresh && distinct >= 2,
      forecasts,
    });
  }

  return { trace, name, frames, errors };
}

export function fitVarianceScale(replays, horizon = null) {
  const traceScales = replays.flatMap(({ errors }) => {
    const values = errors.flatMap((error) =>
      error.variance > 0 && (horizon === null || error.horizon === horizon)
        ? [error.errorSquared / (2 * error.variance)]
        : [],
    );

    return values.length === 0 ? [] : [mean(values)];
  });

  const fitted = mean(traceScales);

  return fitted === null ? null : Math.max(1e-6, fitted);
}

export function forecastMetrics(replays, varianceScale = 1) {
  return HORIZONS.map((horizon) => {
    const errors = replays.flatMap((replay) =>
      replay.errors.filter((error) => error.horizon === horizon),
    );

    const calibrated = errors.flatMap((error) =>
      error.variance > 0 ? [error.errorSquared / (error.variance * varianceScale)] : [],
    );

    return {
      horizonMs: horizon,
      eligibleFrames: replays.reduce(
        (sum, replay) => sum + (replay.frames ?? []).filter((frame) => frame.eligible).length,
        0,
      ),
      forecastFrames: replays.reduce(
        (sum, replay) =>
          sum + (replay.frames ?? []).filter((frame) => frame.forecasts[horizon] !== null).length,
        0,
      ),
      endpointErrorPx: summarize(errors.map((error) => error.errorPx)),
      meanTraceErrorPx: mean(
        replays.flatMap((replay) => {
          const values = replay.errors
            .filter((error) => error.horizon === horizon)
            .map((error) => error.errorPx);

          return values.length === 0 ? [] : [mean(values)];
        }),
      ),
      postChangeErrorPx: summarize(
        errors.flatMap((error) => (error.postChange ? [error.errorPx] : [])),
      ),
      coverage: [0.5, 0.9, 0.95].map((nominal) => ({
        nominal,
        observed: mean(calibrated.map((value) => Number(value <= -2 * Math.log(1 - nominal)))),
        count: calibrated.length,
      })),
    };
  });
}

export function evaluateActions(replay, policy, varianceScale = 1, includeEpisodes = false) {
  const { trace, name } = replay;
  const SubscriptionClass = policy.evidence === 'legacy' ? FrozenSubscription : Subscription;
  const actions = [];
  let aborts = 0;
  let generation = null;
  let currentTime = 0;
  const starts = new Map();

  const subscriptions = new Map(
    trace.targets.map((target) => [
      target.id,
      new SubscriptionClass(
        (event) => {
          const count = starts.get(target.id) ?? 0;
          starts.set(target.id, count + 1);

          const action = {
            target: target.id,
            at: event.at,
            etaMs: event.etaMs,
            restart: count > 0,
            abortedAt: null,
          };

          actions.push(action);
          event.signal.addEventListener(
            'abort',
            () => {
              if (currentTime < trace.cutoff) {
                aborts++;
                action.abortedAt = currentTime;
              }
            },
            { once: true },
          );
        },
        { stableForMs: policy.stableForMs },
        (error) => {
          throw error;
        },
      ),
    ]),
  );

  for (const frame of replay.frames) {
    if (frame.now >= trace.cutoff) {
      break;
    }

    currentTime = frame.now;

    if (generation !== frame.generation) {
      for (const subscription of subscriptions.values()) {
        subscription.invalidate();
      }

      generation = frame.generation;
    }

    const forecast = frame.forecasts[policy.horizonMs];

    for (const target of trace.targets) {
      const subscription = subscriptions.get(target.id);

      if (forecast === null) {
        if (policy.evidence === 'legacy' || frame.evidenceTime === null) {
          subscription.invalidate();
        } else {
          subscription.evaluate(false, frame.now, null, true, frame.evidenceTime);
        }

        continue;
      }

      const hit = forecast[target.id];

      if (!hit.candidate) {
        subscription.evaluate(
          false,
          frame.now,
          null,
          true,
          policy.evidence === 'legacy' ? undefined : frame.evidenceTime,
        );
        continue;
      }

      const contact = subscription.latched && hit.contact;
      const retained = contact || (subscription.latched && hit.etaMs === null && hit.crossed);
      const intersects = hit.etaMs !== null || retained;
      const stdPx = retained ? hit.stdNowPx : hit.stdPx;

      const maxUncertaintyPx =
        policy.uncertaintyRatio === null || policy.uncertaintyRatio === undefined
          ? (policy.maxUncertaintyPx ?? null)
          : policy.uncertaintyRatio *
            Math.min(target.rect.maxX - target.rect.minX, target.rect.maxY - target.rect.minY);

      const certain =
        maxUncertaintyPx === null ||
        (isExperimental(name) &&
          stdPx !== null &&
          stdPx * Math.sqrt(varianceScale) <= maxUncertaintyPx);

      const matches = intersects && (certain || contact);
      const context = matches ? { at: frame.now, etaMs: retained ? 0 : hit.etaMs } : null;
      const eligible = matches && (subscription.latched || hit.etaMs !== 0);
      subscription.evaluate(
        matches,
        frame.now,
        context,
        eligible,
        policy.evidence === 'legacy' ? undefined : frame.evidenceTime,
        contact,
      )?.();
    }
  }

  const first = actions[0] ?? null;
  const correct = first !== null && trace.selected !== null && first.target === trace.selected;

  const result = {
    id: trace.id,
    family: trace.family,
    profile: trace.profile,
    selected: trace.selected !== null,
    correct: Number(correct),
    wrong: Number(first !== null && !correct),
    abstained: Number(first === null),
    leadMs: correct ? trace.cutoff - first.at : null,
    actions: actions.length,
    wrongStarts: actions.filter((action) => action.target !== trace.selected).length,
    aborts,
    restarts: actions.filter((action) => action.restart).length,
    first,
  };

  if (includeEpisodes) {
    result.episodes = actions;
  }

  return result;
}

export function aggregateActions(rows) {
  const total = (key) => rows.reduce((sum, row) => sum + row[key], 0);
  const selections = rows.filter((row) => row.selected).length;

  return {
    trials: rows.length,
    selections,
    correct: total('correct'),
    wrong: total('wrong'),
    abstained: total('abstained'),
    wrongPer100: rows.length === 0 ? null : (total('wrong') * 100) / rows.length,
    usefulCoverage: selections === 0 ? null : total('correct') / selections,
    leadMs: summarize(rows.flatMap((row) => (row.leadMs === null ? [] : [row.leadMs]))),
    starts: total('actions'),
    wrongStarts: total('wrongStarts'),
    aborts: total('aborts'),
    restarts: total('restarts'),
  };
}

export function selectPolicy(candidates, falseActionsPer100) {
  return (
    candidates
      .filter((candidate) => candidate.metrics.wrongPer100 <= falseActionsPer100)
      .toSorted(
        (a, b) =>
          (b.metrics.usefulCoverage ?? 0) - (a.metrics.usefulCoverage ?? 0) ||
          (b.metrics.leadMs.median ?? 0) - (a.metrics.leadMs.median ?? 0) ||
          a.metrics.wrongPer100 - b.metrics.wrongPer100 ||
          a.metrics.starts - b.metrics.starts,
      )[0] ?? null
  );
}
