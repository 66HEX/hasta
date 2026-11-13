import type { PointerSample, Predictor, Rect, TrajectoryHit } from '../types.js';
import { KalmanPredictor } from './kalman-predictor.js';
import type { ConstantVelocityOptions, ConstantVelocityPrediction } from './kalman-predictor.js';

export type { ConstantVelocityOptions, ConstantVelocityPrediction } from './kalman-predictor.js';

export class ConstantVelocityPredictor implements Predictor {
  readonly #filter: KalmanPredictor;

  constructor(options: ConstantVelocityOptions = {}) {
    this.#filter = new KalmanPredictor(options);
  }

  update(sample: PointerSample): void {
    this.#filter.update(sample);
  }

  predict(now: number, horizonMs: number): ConstantVelocityPrediction | null {
    return this.#filter.predict(now, horizonMs);
  }

  intersectRect(now: number, horizonMs: number, rect: Rect): TrajectoryHit | null {
    return this.#filter.intersectRect(now, horizonMs, rect);
  }

  reset(): void {
    this.#filter.reset();
  }
}
