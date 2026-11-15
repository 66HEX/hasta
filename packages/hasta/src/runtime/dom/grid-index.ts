import type { Rect } from '../../core/types.js';

const SIZE = 128;

function cells(rect: Rect, limit: number): string[] | null {
  const left = Math.floor(rect.minX / SIZE);
  const right = Math.floor(rect.maxX / SIZE);
  const top = Math.floor(rect.minY / SIZE);
  const bottom = Math.floor(rect.maxY / SIZE);

  if (
    ![left, right, top, bottom].every((value) => Number.isSafeInteger(value)) ||
    (right - left + 1) * (bottom - top + 1) > limit
  ) {
    return null;
  }

  const result: string[] = [];

  for (let x = left; x <= right; x++) {
    for (let y = top; y <= bottom; y++) {
      result.push(`${x},${y}`);
    }
  }

  return result;
}

/** Bounded grid storage with a conservative fallback for very large rectangles */
export class GridIndex {
  readonly #entries = new Map<number, { rect: Rect; cells: string[] | null }>();
  readonly #buckets = new Map<string, Set<number>>();
  readonly #large = new Set<number>();

  set(id: number, rect: Rect): void {
    this.delete(id);
    const keys = cells(rect, 256);
    this.#entries.set(id, { rect: { ...rect }, cells: keys });

    if (keys === null) {
      this.#large.add(id);

      return;
    }

    for (const key of keys) {
      let bucket = this.#buckets.get(key);

      if (bucket === undefined) {
        bucket = new Set();
        this.#buckets.set(key, bucket);
      }

      bucket.add(id);
    }
  }

  delete(id: number): void {
    const entry = this.#entries.get(id);

    if (entry === undefined) {
      return;
    }

    for (const key of entry.cells ?? []) {
      const bucket = this.#buckets.get(key);
      bucket?.delete(id);

      if (bucket?.size === 0) {
        this.#buckets.delete(key);
      }
    }

    this.#large.delete(id);
    this.#entries.delete(id);
  }

  query(rect: Rect): Set<number> {
    const keys = cells(rect, 4096);
    const candidates = keys === null ? new Set(this.#entries.keys()) : new Set(this.#large);

    if (keys !== null) {
      for (const key of keys) {
        for (const id of this.#buckets.get(key) ?? []) {
          candidates.add(id);
        }
      }
    }

    for (const id of candidates) {
      const bounds = this.#entries.get(id)?.rect;

      if (
        bounds === undefined ||
        rect.minX > bounds.maxX ||
        rect.maxX < bounds.minX ||
        rect.minY > bounds.maxY ||
        rect.maxY < bounds.minY
      ) {
        candidates.delete(id);
      }
    }

    return candidates;
  }
}
