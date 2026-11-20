import type { KalmanPrediction } from '../../core/prediction/kalman-predictor.js';

export const RELEASE_MARGIN_PX = 6;
const RELEASE_DELAY_MS = 32;
const MIN_SPEED_RATIO = 0.7;
const MIN_DIRECTION_COSINE = Math.cos(Math.PI / 12);

function velocity(forecast: KalmanPrediction) {
  const [start, end] = forecast.points;

  return {
    x: (end.x - start.x) / end.offsetMs,
    y: (end.y - start.y) / end.offsetMs,
  };
}

export class IntersectionHysteresis {
  #lastVelocity: ReturnType<typeof velocity> | null = null;
  #missSince: number | null = null;

  reset(): void {
    this.#lastVelocity = null;
    this.#missSince = null;
  }

  match(forecast: KalmanPrediction, observedContact: boolean): void {
    // A real departure after contact must not be treated as speculative jitter
    this.#lastVelocity = observedContact ? null : velocity(forecast);
    this.#missSince = null;
  }

  retain(now: number, forecast: KalmanPrediction, near: boolean): boolean {
    const previous = this.#lastVelocity;

    if (!near || previous === null) {
      this.reset();

      return false;
    }

    const current = velocity(forecast);
    const priorSpeed = Math.hypot(previous.x, previous.y);
    const speed = Math.hypot(current.x, current.y);

    if (priorSpeed === 0 || speed === 0) {
      this.reset();

      return false;
    }

    const cosine =
      (current.x / speed) * (previous.x / priorSpeed) +
      (current.y / speed) * (previous.y / priorSpeed);

    if (!(speed >= priorSpeed * MIN_SPEED_RATIO && cosine >= MIN_DIRECTION_COSINE)) {
      this.reset();

      return false;
    }

    this.#missSince ??= now;

    return now - this.#missSince < RELEASE_DELAY_MS;
  }
}
