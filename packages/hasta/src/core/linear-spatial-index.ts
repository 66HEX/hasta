import type { Rect, SpatialId, SpatialIndex } from './types.js';
import { assertRect } from './validation.js';

export class LinearSpatialIndex<Id extends SpatialId = SpatialId> implements SpatialIndex<Id> {
  readonly #entries = new Map<Id, Rect>();

  get size(): number {
    return this.#entries.size;
  }

  set(id: Id, rect: Rect): void {
    assertRect(rect);
    this.#entries.set(id, { minX: rect.minX, minY: rect.minY, maxX: rect.maxX, maxY: rect.maxY });
  }

  delete(id: Id): boolean {
    return this.#entries.delete(id);
  }

  query(rect: Rect): Id[] {
    assertRect(rect);
    const matches: Id[] = [];

    for (const [id, bounds] of this.#entries) {
      // Entries are private, validated snapshots. The query needs validation only once
      if (
        rect.minX <= bounds.maxX &&
        rect.maxX >= bounds.minX &&
        rect.minY <= bounds.maxY &&
        rect.maxY >= bounds.minY
      ) {
        matches.push(id);
      }
    }

    return matches;
  }

  clear(): void {
    this.#entries.clear();
  }
}
