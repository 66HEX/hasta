import type { Point, Rect } from 'hasta/core';

import type { Sample, Trial } from './types.ts';

export const FEATURE_VERSION = 'cursor-24-12-v1';

function distance(point: Point, rect: Rect) {
  return Math.hypot(
    Math.max(rect.minX - point.x, point.x - rect.maxX, 0),
    Math.max(rect.minY - point.y, point.y - rect.maxY, 0),
  );
}

function velocity(history: Sample[], windowMs: number) {
  const last = history.at(-1);

  if (!last) {
    return { x: 0, y: 0 };
  }

  const first = history.find((sample) => sample.timeStamp >= last.timeStamp - windowMs) ?? last;
  const dt = Math.max(0.001, last.timeStamp - first.timeStamp);

  return { x: (last.x - first.x) / dt, y: (last.y - first.y) / dt };
}

function angle(a: Point, b: Point) {
  if (Math.hypot(a.x, a.y) === 0 || Math.hypot(b.x, b.y) === 0) {
    return 0;
  }

  return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
}

function rayDistance(point: Point, motion: Point, rect: Rect) {
  const speed2 = motion.x ** 2 + motion.y ** 2;

  if (speed2 === 0) {
    return distance(point, rect);
  }

  const times = [0];

  for (const x of [rect.minX, rect.maxX]) {
    if (motion.x !== 0) {
      times.push((x - point.x) / motion.x);
    }

    for (const y of [rect.minY, rect.maxY]) {
      times.push(((x - point.x) * motion.x + (y - point.y) * motion.y) / speed2);
    }
  }

  if (motion.y !== 0) {
    times.push((rect.minY - point.y) / motion.y, (rect.maxY - point.y) / motion.y);
  }

  return Math.min(
    ...times.flatMap((time) =>
      time >= 0
        ? [distance({ x: point.x + motion.x * time, y: point.y + motion.y * time }, rect)]
        : [],
    ),
  );
}

export function featuresAt(trial: Trial, at: number) {
  const reset =
    trial.events.findLast((event) => event.type === 'reset' && event.at <= at)?.at ?? -Infinity;

  const available = trial.samples.filter(
    (sample) => sample.arrivedAt <= at && sample.arrivedAt > reset && sample.buttons === 0,
  );

  const last = available.at(-1);

  if (!last || at - last.timeStamp > 100) {
    return null;
  }

  const history = available.filter((sample) => sample.timeStamp >= last.timeStamp - 160);
  const first = history[0];

  if (!first || last.timeStamp <= first.timeStamp) {
    return null;
  }

  const v32 = velocity(history, 32);
  const v96 = velocity(history, 96);
  const speed = Math.hypot(v32.x, v32.y);

  const acceleration =
    speed === 0 ? 0 : ((v32.x - v96.x) * v32.x + (v32.y - v96.y) * v32.y) / speed / 64;

  const directionChange = angle(v96, v32);
  const age = Math.max(0, at - last.timeStamp);
  const displacement = Math.hypot(last.x - first.x, last.y - first.y);
  let path = 0;

  for (let index = 1; index < history.length; index++) {
    const a = history[index - 1];
    const b = history[index];

    if (a && b) {
      path += Math.hypot(b.x - a.x, b.y - a.y);
    }
  }

  const straightness = path === 0 ? 0 : displacement / path;
  const coverage = Math.min(1, (last.timeStamp - first.timeStamp) / 160);

  const candidate = trial.targets.map(({ rect }) => {
    const dx = (rect.minX + rect.maxX) / 2 - last.x;
    const dy = (rect.minY + rect.maxY) / 2 - last.y;
    const length = Math.hypot(dx, dy);
    const relation = angle(v32, { x: dx, y: dy });

    const closing = (motion: Point) =>
      length === 0 ? 0 : (motion.x * dx + motion.y * dy) / length;

    const lagChange = (lag: number) => {
      const past = history.filter((sample) => sample.timeStamp <= last.timeStamp - lag);
      const point = past.at(-1);

      if (!point) {
        return 0;
      }

      const previous = angle(velocity(past, 32), {
        x: (rect.minX + rect.maxX) / 2 - point.x,
        y: (rect.minY + rect.maxY) / 2 - point.y,
      });

      return Math.atan2(Math.sin(relation - previous), Math.cos(relation - previous));
    };

    return [
      dx,
      dy,
      distance(last, rect),
      rect.maxX - rect.minX,
      rect.maxY - rect.minY,
      distance(last, rect) === 0 ? 1 : 0,
      v32.x,
      v32.y,
      speed,
      acceleration,
      directionChange,
      age,
      speed === 0 ? 0 : Math.cos(relation),
      speed === 0 ? 0 : Math.sin(relation),
      closing(v32),
      closing(v96),
      lagChange(64),
      lagChange(128),
      rayDistance(last, v32, rect),
      speed === 0 ? 0 : Math.min(2000, Math.max(0, (dx * v32.x + dy * v32.y) / (speed * speed))),
      displacement,
      path,
      straightness,
      coverage,
    ];
  });

  const none = [
    v32.x,
    v32.y,
    speed,
    acceleration,
    directionChange,
    age,
    coverage,
    straightness,
    Math.min(...candidate.map((values) => values[2] ?? 0)),
    Math.max(...candidate.map((values) => values[12] ?? 0)),
    Math.max(...candidate.map((values) => values[14] ?? 0)),
    Math.log1p(candidate.length),
  ];

  return { candidate, none };
}

export function examplesFor(trial: Trial) {
  if (trial.plan.phase !== 'main' || trial.quality?.eligible !== true) {
    return [];
  }

  const cutoff =
    trial.selected === null
      ? trial.duration
      : (trial.events.find((event) => event.type === 'enter' && event.target === trial.selected)
          ?.at ?? trial.duration);

  const ticks = trial.ticks.filter((at) => at < cutoff);

  const chosen = new Set(
    Array.from(
      { length: Math.min(24, ticks.length) },
      (_, index) =>
        ticks[
          Math.floor((index * (ticks.length - 1)) / Math.max(1, Math.min(24, ticks.length) - 1))
        ],
    ),
  );

  const examples = [];

  for (const at of chosen) {
    if (at === undefined) {
      continue;
    }

    const features = featuresAt(trial, at);

    if (features) {
      examples.push({
        at,
        ...features,
        label:
          trial.selected === null
            ? trial.targets.length
            : trial.targets.findIndex((target) => target.id === trial.selected),
      });
    }
  }

  return examples.map((example) => Object.assign(example, { weight: 1 / examples.length }));
}
