import type { Rect } from '../../core/types.js';
import type { BoundsSnapshot, TrackedElement } from '../types.js';

export interface MeasuredBounds extends Rect {
  measuredAt: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function measureBounds(
  element: TrackedElement,
  document: Document,
  now: number,
  output: MeasuredBounds,
): boolean {
  if (!element.isConnected || element.ownerDocument !== document) {
    return false;
  }

  const box = element.getBoundingClientRect();
  const { left, top, right, bottom, width, height } = box;

  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(right) ||
    !Number.isFinite(bottom) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    left >= right ||
    top >= bottom
  ) {
    return false;
  }

  output.measuredAt = now;
  output.minX = left;
  output.minY = top;
  output.maxX = right;
  output.maxY = bottom;

  return true;
}

/**
 * Freeze only when geometry escapes through a callback, getBounds or debug output
 */
export function snapshotBounds(bounds: MeasuredBounds): BoundsSnapshot {
  return Object.freeze({
    measuredAt: bounds.measuredAt,
    rect: Object.freeze({
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
    }),
  });
}
