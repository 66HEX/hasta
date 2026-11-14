export const DEFAULT_KALMAN_CONFIG = Object.freeze({
    q: 0.0016,
    r: 0.25,
});
const INNOVATION_LIMIT = 4;
const MAX_MEASUREMENT_INFLATION = 1e6;
const MANEUVER_MIN_SAMPLES = 3;
const MANEUVER_MIN_DURATION_MS = 2;
const MAX_PROCESS_NOISE_SCALE = 8;
const PROCESS_NOISE_RECOVERY_MS = 40;
function finiteEstimate(estimate) {
    return (Number.isFinite(estimate.x) &&
        Number.isFinite(estimate.y) &&
        Number.isFinite(estimate.vx) &&
        Number.isFinite(estimate.vy));
}
export class KalmanState {
    #q;
    #r;
    #mode;
    #checkpoint = {
        timeStamp: null,
        first: null,
        estimate: null,
        pp: 0,
        pv: 0,
        vv: 0,
        innovation: null,
        directionX: 0,
        directionY: 0,
        maneuverSamples: 0,
        linearResidualX: 0,
        linearResidualY: 0,
        linearInnovationVariance: null,
    };
    #timeStamp = null;
    #first = null;
    #estimate = null;
    #pp = 0;
    #pv = 0;
    #vv = 0;
    #innovation = null;
    #directionX = 0;
    #directionY = 0;
    #maneuverSamples = 0;
    #linearResidualX = 0;
    #linearResidualY = 0;
    #linearInnovationVariance = null;
    constructor(config = DEFAULT_KALMAN_CONFIG, mode = 'linear') {
        this.#q = config.q ?? DEFAULT_KALMAN_CONFIG.q;
        this.#r = config.r ?? DEFAULT_KALMAN_CONFIG.r;
        this.#mode = mode;
        if (!Number.isFinite(this.#q) || this.#q < 0 || !Number.isFinite(this.#r) || this.#r <= 0) {
            throw new RangeError('Kalman noise requires finite q >= 0 and r > 0.');
        }
        if (mode !== 'linear' && mode !== 'robust' && mode !== 'adaptive') {
            throw new TypeError('Unknown Kalman mode.');
        }
    }
    reset() {
        this.#timeStamp = null;
        this.#first = null;
        this.#estimate = null;
        this.#pp = 0;
        this.#pv = 0;
        this.#vv = 0;
        this.#innovation = null;
        this.#directionX = 0;
        this.#directionY = 0;
        this.#maneuverSamples = 0;
        this.#linearResidualX = 0;
        this.#linearResidualY = 0;
        this.#linearInnovationVariance = null;
    }
    /** Returns false on arithmetic failure, restoring the checkpoint before this timestamp */
    update(sample) {
        if (!Number.isFinite(sample.x) ||
            !Number.isFinite(sample.y) ||
            !Number.isFinite(sample.timeStamp) ||
            (this.#timeStamp !== null && sample.timeStamp < this.#timeStamp)) {
            return true;
        }
        if (sample.timeStamp === this.#timeStamp) {
            this.#restore();
        }
        else {
            this.#save();
        }
        let accepted = true;
        if (this.#first === null) {
            this.#first = { x: sample.x, y: sample.y, timeStamp: sample.timeStamp };
        }
        else if (this.#estimate === null) {
            accepted = this.#initialize(this.#first, sample);
        }
        else if (this.#timeStamp !== null) {
            accepted = this.#assimilate(sample, sample.timeStamp - this.#timeStamp, this.#estimate);
        }
        if (!accepted) {
            this.#restore();
            return false;
        }
        this.#timeStamp = sample.timeStamp;
        return true;
    }
    state() {
        return this.#estimate;
    }
    diagnostics() {
        let innovation = this.#innovation;
        if (this.#mode === 'linear' && this.#linearInnovationVariance !== null) {
            const length = Math.hypot(this.#linearResidualX, this.#linearResidualY) /
                Math.sqrt(this.#linearInnovationVariance);
            innovation = Object.freeze({
                normalizedSquared: Math.min(Number.MAX_VALUE, length * length),
                measurementWeight: 1,
                processNoiseScale: 1,
                maneuverDurationMs: 0,
            });
        }
        return {
            state: this.#estimate,
            timeStamp: this.#timeStamp,
            covariance: [
                [this.#pp, this.#pv],
                [this.#pv, this.#vv],
            ],
            innovation,
        };
    }
    projectCovariance(durationMs) {
        if (this.#estimate === null || !Number.isFinite(durationMs) || durationMs < 0) {
            return null;
        }
        const q = this.#q * (this.#innovation?.processNoiseScale ?? 1);
        const noiseVV = q * durationMs;
        const noisePV = noiseVV * (durationMs / 2);
        const noisePP = noisePV * ((durationMs * 2) / 3);
        const positionVariancePx2 = this.#pp + durationMs * (2 * this.#pv + durationMs * this.#vv) + noisePP;
        const velocityVariancePx2PerMs2 = this.#vv + noiseVV;
        if (!Number.isFinite(positionVariancePx2) ||
            !Number.isFinite(velocityVariancePx2PerMs2) ||
            positionVariancePx2 < 0 ||
            velocityVariancePx2PerMs2 < 0) {
            return null;
        }
        return { positionVariancePx2, velocityVariancePx2PerMs2 };
    }
    #initialize(previous, latest) {
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
    #assimilate(sample, dt, previous) {
        const predictedX = previous.x + previous.vx * dt;
        const predictedY = previous.y + previous.vy * dt;
        const residualX = sample.x - predictedX;
        const residualY = sample.y - predictedY;
        let processNoiseScale = this.#mode === 'adaptive'
            ? 1 +
                ((this.#innovation?.processNoiseScale ?? 1) - 1) *
                    Math.exp(-dt / PROCESS_NOISE_RECOVERY_MS)
            : 1;
        let noiseVV = this.#q * processNoiseScale * dt;
        let noisePV = noiseVV * (dt / 2);
        let noisePP = noisePV * ((dt * 2) / 3);
        let pp = this.#pp + dt * (2 * this.#pv + dt * this.#vv) + noisePP;
        let pv = this.#pv + dt * this.#vv + noisePV;
        let vv = this.#vv + noiseVV;
        const innovationVariance = pp + this.#r;
        let residualLength = 0;
        let normalizedSquared = 0;
        let directionX = 0;
        let directionY = 0;
        let maneuverSamples = 0;
        let maneuverDurationMs = 0;
        let maneuver = false;
        if (this.#mode !== 'linear') {
            residualLength = Math.hypot(residualX, residualY);
            const normalizedLength = residualLength / Math.sqrt(innovationVariance);
            normalizedSquared = Math.min(Number.MAX_VALUE, normalizedLength * normalizedLength);
            directionX = residualLength > 0 ? residualX / residualLength : 0;
            directionY = residualLength > 0 ? residualY / residualLength : 0;
            const aligned = directionX * this.#directionX + directionY * this.#directionY > 0.5;
            const largeInnovation = normalizedLength > INNOVATION_LIMIT;
            maneuverSamples = largeInnovation ? (aligned ? this.#maneuverSamples + 1 : 1) : 0;
            maneuverDurationMs =
                largeInnovation && aligned
                    ? Math.min(1000, (this.#innovation?.maneuverDurationMs ?? 0) + dt)
                    : 0;
            maneuver =
                this.#mode === 'adaptive' &&
                    maneuverSamples >= MANEUVER_MIN_SAMPLES &&
                    maneuverDurationMs >= MANEUVER_MIN_DURATION_MS;
        }
        if (maneuver) {
            processNoiseScale = Math.min(MAX_PROCESS_NOISE_SCALE, Math.max(processNoiseScale, normalizedSquared / INNOVATION_LIMIT ** 2));
            noiseVV = this.#q * processNoiseScale * dt;
            noisePV = noiseVV * (dt / 2);
            noisePP = noisePV * ((dt * 2) / 3);
            pp = this.#pp + dt * (2 * this.#pv + dt * this.#vv) + noisePP;
            pv = this.#pv + dt * this.#vv + noisePV;
            vv = this.#vv + noiseVV;
        }
        const inflation = this.#mode === 'linear' || maneuver
            ? 1
            : Math.min(MAX_MEASUREMENT_INFLATION, Math.max(1, (residualLength / Math.sqrt(pp + this.#r) / INNOVATION_LIMIT) ** 2));
        const measurementVariance = this.#r * inflation;
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
        const nextVV = adjustedSlope * adjustedSlope * pp + conditionalVV + kv * kv * measurementVariance;
        if (!Number.isFinite(dt) ||
            !Number.isFinite(variance) ||
            !finiteEstimate(estimate) ||
            !Number.isFinite(nextPP) ||
            !Number.isFinite(nextPV) ||
            !Number.isFinite(nextVV)) {
            return false;
        }
        this.#estimate = Object.freeze(estimate);
        this.#pp = nextPP;
        this.#pv = nextPV;
        this.#vv = nextVV;
        if (this.#mode === 'linear') {
            this.#linearResidualX = residualX;
            this.#linearResidualY = residualY;
            this.#linearInnovationVariance = innovationVariance;
        }
        else {
            this.#innovation = Object.freeze({
                normalizedSquared,
                measurementWeight: 1 / inflation,
                processNoiseScale,
                maneuverDurationMs,
            });
            this.#directionX = directionX;
            this.#directionY = directionY;
            this.#maneuverSamples = maneuverSamples;
        }
        return true;
    }
    #save() {
        this.#checkpoint.timeStamp = this.#timeStamp;
        this.#checkpoint.first = this.#first;
        this.#checkpoint.estimate = this.#estimate;
        this.#checkpoint.pp = this.#pp;
        this.#checkpoint.pv = this.#pv;
        this.#checkpoint.vv = this.#vv;
        if (this.#mode === 'linear') {
            this.#checkpoint.linearResidualX = this.#linearResidualX;
            this.#checkpoint.linearResidualY = this.#linearResidualY;
            this.#checkpoint.linearInnovationVariance = this.#linearInnovationVariance;
        }
        else {
            this.#checkpoint.innovation = this.#innovation;
            this.#checkpoint.directionX = this.#directionX;
            this.#checkpoint.directionY = this.#directionY;
            this.#checkpoint.maneuverSamples = this.#maneuverSamples;
        }
    }
    #restore() {
        this.#timeStamp = this.#checkpoint.timeStamp;
        this.#first = this.#checkpoint.first;
        this.#estimate = this.#checkpoint.estimate;
        this.#pp = this.#checkpoint.pp;
        this.#pv = this.#checkpoint.pv;
        this.#vv = this.#checkpoint.vv;
        if (this.#mode === 'linear') {
            this.#linearResidualX = this.#checkpoint.linearResidualX;
            this.#linearResidualY = this.#checkpoint.linearResidualY;
            this.#linearInnovationVariance = this.#checkpoint.linearInnovationVariance;
        }
        else {
            this.#innovation = this.#checkpoint.innovation;
            this.#directionX = this.#checkpoint.directionX;
            this.#directionY = this.#checkpoint.directionY;
            this.#maneuverSamples = this.#checkpoint.maneuverSamples;
        }
    }
}
