import { lineRectInterval, clampPointToRect } from './line-rect.js';
import type { Point, Rect, SegmentHit, TrajectoryHit, TrajectoryPoint } from './types.js';
import { assertPoint, assertRect } from './validation.js';

export function intersectsRect(a: Rect, b: Rect): boolean {
  assertRect(a);
  assertRect(b);

  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function firstSegmentRectIntersection(
  start: Point,
  end: Point,
  rect: Rect,
): SegmentHit | null {
  assertPoint(start);
  assertPoint(end);
  assertRect(rect);

  return segmentRectIntersection(start, end, rect);
}

function segmentRectIntersection(start: Point, end: Point, rect: Rect): SegmentHit | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const interval = lineRectInterval(start, dx, dy, rect);

  if (interval === null) {
    return null;
  }

  const enter = Math.max(0, interval[0]);

  if (enter > Math.min(1, interval[1])) {
    return null;
  }

  return {
    fraction: enter,
    point: clampPointToRect(start.x + dx * enter, start.y + dy * enter, rect),
  };
}

export function firstTrajectoryRectIntersection(
  points: readonly TrajectoryPoint[],
  rect: Rect,
): TrajectoryHit | null {
  assertRect(rect);
  let previousOffset = -1;

  for (const point of points) {
    assertPoint(point);

    if (
      !Number.isFinite(point.offsetMs) ||
      point.offsetMs < 0 ||
      point.offsetMs <= previousOffset
    ) {
      throw new RangeError(
        'Trajectory offsets must be finite, nonnegative and strictly increasing.',
      );
    }

    previousOffset = point.offsetMs;
  }

  const first = points[0];

  if (first === undefined) {
    return null;
  }

  if (points.length === 1) {
    const hit = segmentRectIntersection(first, first, rect);

    return hit === null ? null : { offsetMs: first.offsetMs, point: hit.point };
  }

  let start = first;

  for (let index = 1; index < points.length; index++) {
    const end = points[index];

    if (end === undefined) {
      continue;
    }

    const hit = segmentRectIntersection(start, end, rect);

    if (hit !== null) {
      return {
        offsetMs: start.offsetMs + (end.offsetMs - start.offsetMs) * hit.fraction,
        point: hit.point,
      };
    }

    start = end;
  }

  return null;
}
