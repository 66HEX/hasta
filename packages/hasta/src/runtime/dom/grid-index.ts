import type { Rect } from '../../core/types.js';

const SIZE = 128;
const CELL_LIMIT = 0x2000000;
const CELL_STRIDE = 0x4000000;

function cellKey(x: number, y: number): number {
  return (x + CELL_LIMIT) * CELL_STRIDE + (y + CELL_LIMIT);
}

function inGridBounds(
  left: number,
  right: number,
  top: number,
  bottom: number,
  limit: number,
): boolean {
  return (
    left >= -CELL_LIMIT &&
    right < CELL_LIMIT &&
    top >= -CELL_LIMIT &&
    bottom < CELL_LIMIT &&
    (right - left + 1) * (bottom - top + 1) <= limit
  );
}

/** Bounded grid storage with a conservative fallback for very large rectangles */
export class GridIndex {
  readonly #entries = new Map<number, { rect: Rect; cells: number[] | null }>();
  readonly #buckets = new Map<number, Set<number>>();
  readonly #large = new Set<number>();

  set(id: number, rect: Rect): void {
    this.delete(id);
    const left = Math.floor(rect.minX / SIZE);
    const right = Math.floor(rect.maxX / SIZE);
    const top = Math.floor(rect.minY / SIZE);
    const bottom = Math.floor(rect.maxY / SIZE);

    if (!inGridBounds(left, right, top, bottom, 256)) {
      this.#entries.set(id, { rect: { ...rect }, cells: null });
      this.#large.add(id);

      return;
    }

    const keys: number[] = [];

    for (let x = left; x <= right; x++) {
      for (let y = top; y <= bottom; y++) {
        const key = cellKey(x, y);
        keys.push(key);
        let bucket = this.#buckets.get(key);

        if (bucket === undefined) {
          bucket = new Set();
          this.#buckets.set(key, bucket);
        }

        bucket.add(id);
      }
    }

    this.#entries.set(id, { rect: { ...rect }, cells: keys });
  }

  delete(id: number): void {
    const entry = this.#entries.get(id);

    if (entry === undefined) {
      return;
    }

    if (entry.cells !== null) {
      for (const key of entry.cells) {
        const bucket = this.#buckets.get(key);
        bucket?.delete(id);

        if (bucket?.size === 0) {
          this.#buckets.delete(key);
        }
      }
    }

    this.#large.delete(id);
    this.#entries.delete(id);
  }

  query(rect: Rect): Set<number> {
    const left = Math.floor(rect.minX / SIZE);
    const right = Math.floor(rect.maxX / SIZE);
    const top = Math.floor(rect.minY / SIZE);
    const bottom = Math.floor(rect.maxY / SIZE);
    const bounded = inGridBounds(left, right, top, bottom, 4096);

    const candidates = bounded
      ? this.#large.size > 0
        ? new Set(this.#large)
        : new Set<number>()
      : new Set(this.#entries.keys());

    if (bounded) {
      for (let x = left; x <= right; x++) {
        for (let y = top; y <= bottom; y++) {
          const bucket = this.#buckets.get(cellKey(x, y));

          if (bucket === undefined) {
            continue;
          }

          for (const id of bucket) {
            candidates.add(id);
          }
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
