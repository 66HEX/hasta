import type { PointerSample } from '../../core/types.js';

export class ObservedPath {
  private points: PointerSample[] = [];
  private head = 0;
  private pending = false;

  constructor(private readonly maxAgeMs: number) {}

  push(sample: PointerSample): void {
    const last = this.points.at(-1);

    if (last && sample.timeStamp < last.timeStamp) {
      return;
    }

    if (last?.timeStamp === sample.timeStamp) {
      this.points[this.points.length - 1] = sample;
    } else {
      this.points.push(sample);
    }

    this.pending = true;
    this.prune(sample.timeStamp - this.maxAgeMs);
  }

  take(now: number): readonly PointerSample[] {
    if (!this.pending) {
      return [];
    }

    const cutoff = now - this.maxAgeMs;
    this.prune(cutoff);
    const points = this.points.slice(this.head);
    const first = points[0];
    const second = points[1];
    const last = points.at(-1);
    this.points = last ? [last] : [];
    this.head = 0;
    this.pending = false;

    if (!last || last.timeStamp <= cutoff) {
      this.clear();

      return [];
    }

    if (first && second && first.timeStamp < cutoff) {
      const fraction = (cutoff - first.timeStamp) / (second.timeStamp - first.timeStamp);
      points[0] = {
        x: first.x + (second.x - first.x) * fraction,
        y: first.y + (second.y - first.y) * fraction,
        timeStamp: cutoff,
      };
    }

    return points;
  }

  clear(): void {
    this.points = [];
    this.head = 0;
    this.pending = false;
  }

  private prune(cutoff: number): void {
    while (this.head + 1 < this.points.length) {
      const next = this.points[this.head + 1];

      if (!next || next.timeStamp > cutoff) {
        break;
      }

      this.head++;
    }

    if (this.head >= 256 && this.head * 2 >= this.points.length) {
      this.points = this.points.slice(this.head);
      this.head = 0;
    }
  }
}
