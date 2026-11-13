/* oxlint-disable max-classes-per-file -- Each private class implements one part of this experimental comparison */
import { ConstantVelocityPredictor as ProductionPredictor } from '../../dist/core/index.js';
import { KalmanPredictor } from '../../dist/core/prediction/kalman-predictor.js';
import { ConstantVelocityPredictor } from './baseline-23e16ac/core/prediction/constant-velocity.js';
import { Random } from './random.mjs';

function nonnegative(value, name, allowZero = false) {
  if (!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)) {
    throw new RangeError(`${name} must be finite and ${allowZero ? 'nonnegative' : 'positive'}.`);
  }

  return value;
}

function prediction(state, now, age, horizon) {
  const x = state.x + state.vx * age;
  const y = state.y + state.vy * age;
  const endX = x + state.vx * horizon;
  const endY = y + state.vy * horizon;

  if (![x, y, endX, endY].every((value) => Number.isFinite(value))) {
    return null;
  }

  return Object.freeze({
    generatedAt: now,
    points: Object.freeze([
      Object.freeze({ x, y, offsetMs: 0 }),
      Object.freeze({ x: endX, y: endY, offsetMs: horizon }),
    ]),
  });
}

class StreamingModel {
  constructor(kernel, maxAge) {
    this.kernel = kernel;
    this.maxAge = maxAge;
    this.reset();
  }

  reset() {
    this.latestTime = null;
    this.previousTime = null;
    this.count = 0;
    this.checkpoint = null;
    this.kernel.reset();
  }

  update(sample) {
    if (![sample.x, sample.y, sample.timeStamp].every((value) => Number.isFinite(value))) {
      return;
    }

    if (this.latestTime !== null && sample.timeStamp < this.latestTime) {
      return;
    }

    if (this.latestTime !== null && sample.timeStamp - this.latestTime >= this.maxAge) {
      this.reset();
    }

    if (sample.timeStamp === this.latestTime) {
      this.kernel.restore(this.checkpoint);
    } else {
      this.checkpoint = this.kernel.save();
      this.previousTime = this.latestTime;
      this.count++;
    }

    const dt = this.previousTime === null ? null : sample.timeStamp - this.previousTime;

    if (this.kernel.update(sample, dt) === false) {
      this.reset();
      this.checkpoint = this.kernel.save();
      this.kernel.update(sample, null);
      this.count = 1;
    }

    this.latestTime = sample.timeStamp;
  }

  predict(now, horizonMs) {
    if (!Number.isFinite(now) || !Number.isFinite(horizonMs) || horizonMs <= 0) {
      throw new RangeError('Prediction time must be finite and horizonMs must be positive.');
    }

    if (this.count < 2) {
      return null;
    }

    const age = now - this.latestTime;

    if (age < 0 || age >= this.maxAge) {
      return null;
    }

    return prediction(this.kernel.state(), now, age, horizonMs);
  }

  getDiagnostics() {
    return this.kernel.diagnostics();
  }
}

class Regression {
  constructor(windowMs) {
    this.windowMs = windowMs;
  }

  reset() {
    this.points = [];
    this.estimate = { x: 0, y: 0, vx: 0, vy: 0 };
  }

  save() {
    return null;
  }

  restore() {}

  update(sample) {
    const point = { x: sample.x, y: sample.y, timeStamp: sample.timeStamp };

    if (this.points.at(-1)?.timeStamp === point.timeStamp) {
      this.points[this.points.length - 1] = point;
    } else {
      this.points.push(point);
    }

    while (this.points.length > 2 && this.points[0].timeStamp < point.timeStamp - this.windowMs) {
      this.points.shift();
    }

    let sumT = 0;
    let sumX = 0;
    let sumY = 0;

    for (const item of this.points) {
      sumT += item.timeStamp - point.timeStamp;
      sumX += item.x - point.x;
      sumY += item.y - point.y;
    }

    const meanT = sumT / this.points.length;
    const meanX = sumX / this.points.length;
    const meanY = sumY / this.points.length;
    let variance = 0;
    let crossX = 0;
    let crossY = 0;

    for (const item of this.points) {
      const dt = item.timeStamp - point.timeStamp - meanT;
      variance += dt * dt;
      crossX += dt * (item.x - point.x - meanX);
      crossY += dt * (item.y - point.y - meanY);
    }

    // The fit estimates velocity while the latest measured position remains the anchor
    this.estimate = {
      x: point.x,
      y: point.y,
      vx: variance === 0 ? 0 : crossX / variance,
      vy: variance === 0 ? 0 : crossY / variance,
    };

    return Object.values(this.estimate).every((value) => Number.isFinite(value));
  }

  state() {
    return this.estimate;
  }

  diagnostics() {
    return { state: { ...this.estimate }, samples: this.points.length };
  }
}

class Kalman {
  constructor(q, r, initialVelocityStd) {
    this.q = q;
    this.r = r;
    this.initialVelocityVariance = initialVelocityStd ** 2;
  }

  reset() {
    this.estimate = { x: 0, y: 0, vx: 0, vy: 0 };
    this.pp = this.r;
    this.pv = 0;
    this.vv = this.initialVelocityVariance;
  }

  save() {
    return { estimate: { ...this.estimate }, pp: this.pp, pv: this.pv, vv: this.vv };
  }

  restore(value) {
    this.estimate = { ...value.estimate };
    this.pp = value.pp;
    this.pv = value.pv;
    this.vv = value.vv;
  }

  update(sample, dt) {
    if (dt === null) {
      this.estimate = { x: sample.x, y: sample.y, vx: 0, vy: 0 };

      return;
    }

    const pp = this.pp + 2 * dt * this.pv + dt * dt * this.vv + (this.q * dt ** 3) / 3;
    const pv = this.pv + dt * this.vv + (this.q * dt * dt) / 2;
    const vv = this.vv + this.q * dt;
    const innovationVariance = pp + this.r;
    const kp = pp / innovationVariance;
    const kv = pv / innovationVariance;
    const predictedX = this.estimate.x + dt * this.estimate.vx;
    const predictedY = this.estimate.y + dt * this.estimate.vy;
    const residualX = sample.x - predictedX;
    const residualY = sample.y - predictedY;
    this.estimate = {
      x: predictedX + kp * residualX,
      y: predictedY + kp * residualY,
      vx: this.estimate.vx + kv * residualX,
      vy: this.estimate.vy + kv * residualY,
    };

    // Joseph covariance update retains symmetry and avoids subtracting nearly equal matrices
    const retained = 1 - kp;
    this.pp = retained * retained * pp + kp * kp * this.r;
    this.pv = retained * (pv - kv * pp) + kp * kv * this.r;
    this.vv = Math.max(0, vv - 2 * kv * pv + kv * kv * (pp + this.r));

    return [...Object.values(this.estimate), this.pp, this.pv, this.vv].every((value) =>
      Number.isFinite(value),
    );
  }

  state() {
    return this.estimate;
  }

  diagnostics() {
    return {
      state: { ...this.estimate },
      covariance: [
        [this.pp, this.pv],
        [this.pv, this.vv],
      ],
    };
  }
}

function particleArrays(count) {
  return {
    x: new Float64Array(count),
    y: new Float64Array(count),
    vx: new Float64Array(count),
    vy: new Float64Array(count),
    weights: new Float64Array(count),
  };
}

function copyParticles(from, to) {
  for (const key of ['x', 'y', 'vx', 'vy', 'weights']) {
    to[key].set(from[key]);
  }
}

class Particle {
  constructor(q, r, count, observation, initialVelocityStd, seed) {
    this.q = q;
    this.r = r;
    this.count = count;
    this.observation = observation;
    this.initialVelocityStd = initialVelocityStd;
    this.random = new Random(seed);
    this.values = particleArrays(count);
    this.scratch = particleArrays(count);
    this.backup = { values: particleArrays(count) };
    this.logWeights = new Float64Array(count);
  }

  reset() {
    this.random.reset();
    this.estimate = { x: 0, y: 0, vx: 0, vy: 0 };
    this.ess = this.count;
    this.resamples = 0;
    this.values.weights.fill(1 / this.count);
  }

  save() {
    copyParticles(this.values, this.backup.values);
    this.backup.random = this.random.snapshot();
    this.backup.estimate = { ...this.estimate };
    this.backup.ess = this.ess;
    this.backup.resamples = this.resamples;

    return this.backup;
  }

  restore(value) {
    copyParticles(value.values, this.values);
    this.random.restore(value.random);
    this.estimate = { ...value.estimate };
    this.ess = value.ess;
    this.resamples = value.resamples;
  }

  update(sample, dt) {
    if (dt === null) {
      const positionStd = Math.sqrt(this.r);

      for (let index = 0; index < this.count; index++) {
        this.values.x[index] = sample.x + positionStd * this.random.normal();
        this.values.y[index] = sample.y + positionStd * this.random.normal();
        this.values.vx[index] = this.initialVelocityStd * this.random.normal();
        this.values.vy[index] = this.initialVelocityStd * this.random.normal();
      }

      this.estimate = this.weightedState();

      return;
    }

    const velocityStd = Math.sqrt(this.q * dt);
    const positionStd = Math.sqrt((this.q * dt ** 3) / 12);
    let maxLogWeight = -Infinity;

    for (let index = 0; index < this.count; index++) {
      const dvx = velocityStd * this.random.normal();
      const dvy = velocityStd * this.random.normal();
      this.values.x[index] +=
        this.values.vx[index] * dt + (dt / 2) * dvx + positionStd * this.random.normal();
      this.values.y[index] +=
        this.values.vy[index] * dt + (dt / 2) * dvy + positionStd * this.random.normal();
      this.values.vx[index] += dvx;
      this.values.vy[index] += dvy;
      const dx = sample.x - this.values.x[index];
      const dy = sample.y - this.values.y[index];
      const squaredDistance = dx * dx + dy * dy;

      // The bivariate Student t uses four degrees of freedom and marginal variance r
      const logLikelihood =
        this.observation === 'student-t'
          ? -3 * Math.log1p(squaredDistance / (2 * this.r))
          : -squaredDistance / (2 * this.r);

      const weight = Math.log(this.values.weights[index]) + logLikelihood;
      this.logWeights[index] = weight;
      maxLogWeight = Math.max(maxLogWeight, weight);
    }

    if (!Number.isFinite(maxLogWeight)) {
      return false;
    }

    let sum = 0;

    for (let index = 0; index < this.count; index++) {
      const weight = Math.exp(this.logWeights[index] - maxLogWeight);
      this.values.weights[index] = weight;
      sum += weight;
    }

    let squaredWeights = 0;

    for (let index = 0; index < this.count; index++) {
      const weight = this.values.weights[index] / sum;
      this.values.weights[index] = weight;
      squaredWeights += weight * weight;
    }

    this.ess = 1 / squaredWeights;
    this.estimate = this.weightedState();

    if (this.ess < this.count / 2) {
      this.resample();
    }
  }

  weightedState() {
    const anchor = {
      x: this.values.x[0],
      y: this.values.y[0],
      vx: this.values.vx[0],
      vy: this.values.vy[0],
    };

    const estimate = { x: 0, y: 0, vx: 0, vy: 0 };

    for (let index = 0; index < this.count; index++) {
      const weight = this.values.weights[index];
      estimate.x += weight * (this.values.x[index] - anchor.x);
      estimate.y += weight * (this.values.y[index] - anchor.y);
      estimate.vx += weight * (this.values.vx[index] - anchor.vx);
      estimate.vy += weight * (this.values.vy[index] - anchor.vy);
    }

    return {
      x: anchor.x + estimate.x,
      y: anchor.y + estimate.y,
      vx: anchor.vx + estimate.vx,
      vy: anchor.vy + estimate.vy,
    };
  }

  resample() {
    const offset = this.random.uniform() / this.count;
    let source = 0;
    let cumulative = this.values.weights[0];

    for (let index = 0; index < this.count; index++) {
      const position = offset + index / this.count;

      while (position > cumulative && source < this.count - 1) {
        source++;
        cumulative += this.values.weights[source];
      }

      for (const key of ['x', 'y', 'vx', 'vy']) {
        this.scratch[key][index] = this.values[key][source];
      }
    }

    const previous = this.values;
    this.values = this.scratch;
    this.scratch = previous;
    this.values.weights.fill(1 / this.count);
    this.resamples++;
  }

  state() {
    return this.estimate;
  }

  diagnostics() {
    return {
      state: { ...this.estimate },
      /** This is the measurement posterior ESS before optional resampling */
      ess: this.ess,
      weightSum: this.values.weights.reduce((sum, weight) => sum + weight, 0),
      resamples: this.resamples,
      particles: this.count,
    };
  }
}

export function createModel(config, seed = 0x451ab3) {
  const maxAge = nonnegative(config.maxSampleAgeMs ?? 100, 'maxSampleAgeMs');

  if (config.kind === 'production') {
    return new ProductionPredictor({ maxSampleAgeMs: maxAge });
  }

  if (config.kind === 'kalman-candidate') {
    return new KalmanPredictor({ maxSampleAgeMs: maxAge }, config);
  }

  if (config.kind === 'cv') {
    return new ConstantVelocityPredictor({ maxSampleAgeMs: maxAge });
  }

  if (config.kind === 'regression') {
    return new StreamingModel(
      new Regression(nonnegative(config.windowMs ?? 16, 'windowMs')),
      maxAge,
    );
  }

  const q = nonnegative(config.q ?? 1e-4, 'q', true);
  const r = nonnegative(config.r ?? 0.25, 'r');

  const initialVelocityStd = nonnegative(
    config.initialVelocityStd ?? 2,
    'initialVelocityStd',
    true,
  );

  if (config.kind === 'kalman') {
    return new StreamingModel(new Kalman(q, r, initialVelocityStd), maxAge);
  }

  if (config.kind === 'particle') {
    const count = config.particles ?? 256;
    const observation = config.observation ?? 'gaussian';

    if (!Number.isInteger(count) || count < 2) {
      throw new RangeError('particles must be an integer of at least two.');
    }

    if (observation !== 'gaussian' && observation !== 'student-t') {
      throw new TypeError('Unknown particle observation model.');
    }

    return new StreamingModel(
      new Particle(q, r, count, observation, initialVelocityStd, seed),
      maxAge,
    );
  }

  throw new TypeError('Unknown prediction model.');
}
