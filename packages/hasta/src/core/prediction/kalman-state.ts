import type { PointerSample } from '../types.js';

export interface KalmanConfig {
  readonly q?: number;
  readonly r?: number;
}

export interface KalmanEstimate {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
}

export const DEFAULT_KALMAN_CONFIG: Readonly<Required<KalmanConfig>> = Object.freeze({
  q: 0.0016,
  r: 0.25,
});

interface Checkpoint {
  timeStamp: number | null;
  first: PointerSample | null;
  estimate: KalmanEstimate | null;
  pp: number;
  pv: number;
  vv: number;
}

type MeasurementInflation = (
  residualX: number,
  residualY: number,
  innovationVariance: number,
  dt: number,
) => number;

type ProcessNoiseScale = (residualX: number, residualY: number, dt: number) => number;

function finiteEstimate(estimate: KalmanEstimate): boolean {
  return (
    Number.isFinite(estimate.x) &&
    Number.isFinite(estimate.y) &&
    Number.isFinite(estimate.vx) &&
    Number.isFinite(estimate.vy)
  );
}

export class KalmanState {
  readonly #q: number;
  readonly #r: number;
  readonly #checkpoint: Checkpoint = {
    timeStamp: null,
    first: null,
    estimate: null,
    pp: 0,
    pv: 0,
    vv: 0,
  };
  #timeStamp: number | null = null;
  #first: PointerSample | null = null;
  #estimate: KalmanEstimate | null = null;
  #pp = 0;
  #pv = 0;
  #vv = 0;

  constructor(config: KalmanConfig = DEFAULT_KALMAN_CONFIG) {
    this.#q = config.q ?? DEFAULT_KALMAN_CONFIG.q;
    this.#r = config.r ?? DEFAULT_KALMAN_CONFIG.r;

    if (!Number.isFinite(this.#q) || this.#q < 0 || !Number.isFinite(this.#r) || this.#r <= 0) {
      throw new RangeError('Kalman noise requires finite q >= 0 and r > 0.');
    }
  }

  reset(): void {
    this.#timeStamp = null;
    this.#first = null;
    this.#estimate = null;
    this.#pp = 0;
    this.#pv = 0;
    this.#vv = 0;
  }

  /** Returns false on arithmetic failure, restoring the checkpoint before this timestamp */
  update(
    sample: PointerSample,
    measurementInflation?: MeasurementInflation,
    processNoiseScale?: ProcessNoiseScale,
  ): boolean {
    if (
      !Number.isFinite(sample.x) ||
      !Number.isFinite(sample.y) ||
      !Number.isFinite(sample.timeStamp) ||
      (this.#timeStamp !== null && sample.timeStamp < this.#timeStamp)
    ) {
      return true;
    }

    if (sample.timeStamp === this.#timeStamp) {
      this.#restore();
    } else {
      this.#save();
    }

    let accepted = true;

    if (this.#first === null) {
      this.#first = { x: sample.x, y: sample.y, timeStamp: sample.timeStamp };
    } else if (this.#estimate === null) {
      accepted = this.#initialize(this.#first, sample);
    } else if (this.#timeStamp !== null) {
      accepted = this.#assimilate(
        sample,
        sample.timeStamp - this.#timeStamp,
        this.#estimate,
        measurementInflation,
        processNoiseScale,
      );
    }

    if (!accepted) {
      this.#restore();

      return false;
    }

    this.#timeStamp = sample.timeStamp;

    return true;
  }

  state(): KalmanEstimate | null {
    return this.#estimate;
  }

  diagnostics() {
    return {
      state: this.#estimate,
      timeStamp: this.#timeStamp,
      covariance: [
        [this.#pp, this.#pv],
        [this.#pv, this.#vv],
      ],
    };
  }

  #initialize(previous: PointerSample, latest: PointerSample): boolean {
    const dt = latest.timeStamp - previous.timeStamp;

    const estimate = {
      x: latest.x,
      y: latest.y,
      vx: (latest.x - previous.x) / dt,
      vy: (latest.y - previous.y) / dt,
    };

    const pv = this.#r / dt;
    const vv = (pv / dt) * 2 + this.#q * (dt / 3);

    if (!Number.isFinite(dt) || !finiteEstimate(estimate) || !Number.isFinite(vv)) {
      return false;
    }

    this.#estimate = Object.freeze(estimate);
    this.#pp = this.#r;
    this.#pv = pv;
    this.#vv = vv;

    return true;
  }

  #assimilate(
    sample: PointerSample,
    dt: number,
    previous: KalmanEstimate,
    measurementInflation?: MeasurementInflation,
    processNoiseScale?: ProcessNoiseScale,
  ): boolean {
    const predictedX = previous.x + previous.vx * dt;
    const predictedY = previous.y + previous.vy * dt;
    const residualX = sample.x - predictedX;
    const residualY = sample.y - predictedY;
    const scale = processNoiseScale?.(residualX, residualY, dt) ?? 1;
    const noiseVV = this.#q * scale * dt;
    const noisePV = noiseVV * (dt / 2);
    const noisePP = noisePV * ((dt * 2) / 3);
    const pp = this.#pp + dt * (2 * this.#pv + dt * this.#vv) + noisePP;
    const pv = this.#pv + dt * this.#vv + noisePV;
    const vv = this.#vv + noiseVV;

    const measurementVariance =
      measurementInflation === undefined
        ? this.#r
        : this.#r * measurementInflation(residualX, residualY, pp + this.#r, dt);

    const variance = pp + measurementVariance;
    const kp = pp / variance;
    const kv = pv / variance;

    const estimate = {
      x: predictedX + kp * residualX,
      y: predictedY + kp * residualY,
      vx: previous.vx + kv * residualX,
      vy: previous.vy + kv * residualY,
    };

    // Factored Joseph update keeps each contribution to the variance nonnegative
    const retained = measurementVariance / variance;
    const slope = pp === 0 ? 0 : pv / pp;
    const conditionalVV = Math.max(0, vv - pv * slope);
    const adjustedSlope = slope - kv;
    const nextPP = retained * retained * pp + kp * kp * measurementVariance;
    const nextPV = retained * adjustedSlope * pp + kp * kv * measurementVariance;

    const nextVV =
      adjustedSlope * adjustedSlope * pp + conditionalVV + kv * kv * measurementVariance;

    if (
      !Number.isFinite(dt) ||
      !Number.isFinite(scale) ||
      scale < 0 ||
      !Number.isFinite(measurementVariance) ||
      measurementVariance <= 0 ||
      !Number.isFinite(variance) ||
      !finiteEstimate(estimate) ||
      !Number.isFinite(nextPP) ||
      !Number.isFinite(nextPV) ||
      !Number.isFinite(nextVV)
    ) {
      return false;
    }

    this.#estimate = Object.freeze(estimate);
    this.#pp = nextPP;
    this.#pv = nextPV;
    this.#vv = nextVV;

    return true;
  }

  #save(): void {
    this.#checkpoint.timeStamp = this.#timeStamp;
    this.#checkpoint.first = this.#first;
    this.#checkpoint.estimate = this.#estimate;
    this.#checkpoint.pp = this.#pp;
    this.#checkpoint.pv = this.#pv;
    this.#checkpoint.vv = this.#vv;
  }

  #restore(): void {
    this.#timeStamp = this.#checkpoint.timeStamp;
    this.#first = this.#checkpoint.first;
    this.#estimate = this.#checkpoint.estimate;
    this.#pp = this.#checkpoint.pp;
    this.#pv = this.#checkpoint.pv;
    this.#vv = this.#checkpoint.vv;
  }
}
