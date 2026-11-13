import type { BoundsSnapshot } from '../types.js';

export function measureBounds(
  element: HTMLElement,
  document: Document,
  now: number,
): BoundsSnapshot | null {
  if (!element.isConnected || element.ownerDocument !== document) {
    return null;
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
    return null;
  }

  return Object.freeze({
    measuredAt: now,
    rect: Object.freeze({ minX: left, minY: top, maxX: right, maxY: bottom }),
  });
}
