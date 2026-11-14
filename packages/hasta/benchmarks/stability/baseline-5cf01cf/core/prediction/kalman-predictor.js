import { lineRectInterval, clampPointToRect, scaledRatio } from '../line-rect.js';
import { assertRect } from '../validation.js';
import { DEFAULT_KALMAN_CONFIG, KalmanState } from './kalman-state.js';
export const DEFAULT_ASSIMILATION_INTERVAL_MS = 0;
export const DEFAULT_POSITION_ANCHOR = 'filtered';
const INNOVATION_LIMIT = 6;
const MAX_MEASUREMENT_INFLATION = 1e6;
const MANEUVER_MIN_DURATION_MS = 2;
const DENSE_SAMPLE_INTERVAL_MS = 8;
const MAX_PROVISIONAL_GAP_MS = 40;
const MAX_PLAUSIBLE_SPEED_RATIO = 1.5;
function displacement(delta, dt, durationMs) {
    const velocity = delta / dt;
    // Scale the displacement before a subnormal velocity loses significant bits
    return Math.abs(velocity) < 2 ** -1022 && delta !== 0
        ? scaledRatio(delta, durationMs, dt)
        : velocity * durationMs;
}
export class KalmanPredictor {
    #maxSampleAgeMs;
    #filter;
    #minimumAssimilationDtMs;
    #positionAnchor;
    #measurementVariance;
    #filterSamples = 0;
    #previousAssimilated = null;
    #latestAssimilated = null;
    #checkpointSamples = 0;
    #checkpointPrevious = null;
    #checkpointLatest = null;
    #failedTimeStamp = null;
    #previous = null;
    #latest = null;
    #directionX = 0;
    #directionY = 0;
    #maneuverSamples = 0;
    #maneuverDurationMs = 0;
    #checkpointDirectionX = 0;
    #checkpointDirectionY = 0;
    #checkpointManeuverSamples = 0;
    #checkpointManeuverDurationMs = 0;
    #measurementInflation = (residualX, residualY, innovationVariance, dt) => {
        const sparse = dt > DENSE_SAMPLE_INTERVAL_MS;
        let bypass = dt > MAX_PROVISIONAL_GAP_MS;
        if (sparse && !bypass) {
            const prior = this.#filter.state();
            const previous = this.#latestAssimilated;
            const current = this.#latest;
            if (prior === null || previous === null || current === null) {
                bypass = true;
            }
            else {
                const dx = current.x - previous.x;
                const dy = current.y - previous.y;
                let speed = Math.hypot(prior.vx, prior.vy);
                const older = this.#previousAssimilated;
                // The filtered speed can temporarily lag behind an accepted turn
                if (older !== null) {
                    const previousDt = previous.timeStamp - older.timeStamp;
                    if (previousDt > 0 && previousDt <= MAX_PROVISIONAL_GAP_MS) {
                        const measuredSpeed = Math.hypot((previous.x - older.x) / previousDt, (previous.y - older.y) / previousDt);
                        if (Number.isFinite(measuredSpeed)) {
                            speed = Math.max(speed, measuredSpeed);
                        }
                    }
                }
                bypass =
                    dx * prior.vx + dy * prior.vy <= 0 ||
                        Math.hypot(dx, dy) <= MAX_PLAUSIBLE_SPEED_RATIO * speed * dt;
            }
        }
        if (bypass) {
            this.#directionX = 0;
            this.#directionY = 0;
            this.#maneuverSamples = 0;
            this.#maneuverDurationMs = 0;
            return 1;
        }
        const length = Math.hypot(residualX, residualY);
        const normalizedLength = length / Math.sqrt(innovationVariance);
        const directionX = length > 0 ? residualX / length : 0;
        const directionY = length > 0 ? residualY / length : 0;
        const aligned = directionX * this.#directionX + directionY * this.#directionY > 0.5;
        const large = normalizedLength > INNOVATION_LIMIT;
        this.#maneuverSamples = large ? (aligned ? this.#maneuverSamples + 1 : 1) : 0;
        this.#maneuverDurationMs = large && aligned ? Math.min(1000, this.#maneuverDurationMs + dt) : 0;
        this.#directionX = directionX;
        this.#directionY = directionY;
        // Persistent innovations restore ordinary weighting for a change in motion
        const maneuver = this.#maneuverSamples >= 2 && this.#maneuverDurationMs >= MANEUVER_MIN_DURATION_MS;
        // Ordinary innovations avoid S/R, which can overflow for a tiny configured R
        // Sparse outliers inflate total innovation variance, dense samples retain their weighting
        return maneuver ||
            normalizedLength <= INNOVATION_LIMIT ||
            !Number.isFinite(normalizedLength ** 2)
            ? 1
            : Math.min(MAX_MEASUREMENT_INFLATION, 1 +
                Math.max(0, (normalizedLength / INNOVATION_LIMIT) ** 2 - 1) *
                    (sparse ? innovationVariance / this.#measurementVariance : 1));
    };
    constructor(options = {}, config = {}) {
        this.#filter = new KalmanState(config);
        this.#measurementVariance = config.r ?? DEFAULT_KALMAN_CONFIG.r;
        this.#minimumAssimilationDtMs =
            config.minimumAssimilationDtMs ?? DEFAULT_ASSIMILATION_INTERVAL_MS;
        this.#positionAnchor = config.positionAnchor ?? DEFAULT_POSITION_ANCHOR;
        if (!Number.isFinite(this.#minimumAssimilationDtMs) || this.#minimumAssimilationDtMs < 0) {
            throw new RangeError('The assimilation interval must be finite and nonnegative.');
        }
        if (this.#positionAnchor !== 'filtered' && this.#positionAnchor !== 'measured') {
            throw new TypeError('Unknown prediction position anchor.');
        }
        this.#maxSampleAgeMs = options.maxSampleAgeMs ?? 100;
        if (!Number.isFinite(this.#maxSampleAgeMs) || this.#maxSampleAgeMs <= 0) {
            throw new RangeError('maxSampleAgeMs must be finite and positive.');
        }
    }
    update(sample) {
        if (!Number.isFinite(sample.x) ||
            !Number.isFinite(sample.y) ||
            !Number.isFinite(sample.timeStamp)) {
            return;
        }
        const latest = this.#latest;
        if (latest !== null) {
            if (sample.timeStamp < latest.timeStamp) {
                return;
            }
            if (sample.timeStamp === latest.timeStamp && sample.x === latest.x && sample.y === latest.y) {
                return;
            }
            if (sample.timeStamp > latest.timeStamp) {
                const expired = sample.timeStamp - latest.timeStamp >= this.#maxSampleAgeMs;
                this.#previous = expired ? null : latest;
                if (expired) {
                    this.#resetFilter();
                }
                else if (this.#failedTimeStamp !== null) {
                    // A later timestamp starts a fresh estimate from the last raw measurement
                    this.#resetFilter();
                    this.#filter.update(latest);
                    this.#filterSamples = 1;
                    this.#latestAssimilated = latest;
                }
            }
        }
        this.#latest = { x: sample.x, y: sample.y, timeStamp: sample.timeStamp };
        const assimilated = this.#latestAssimilated;
        if (assimilated !== null &&
            sample.timeStamp > assimilated.timeStamp &&
            sample.timeStamp - assimilated.timeStamp < this.#minimumAssimilationDtMs) {
            return;
        }
        if (assimilated !== null && sample.timeStamp === assimilated.timeStamp) {
            this.#restoreMetadata();
        }
        else {
            this.#checkpointSamples = this.#filterSamples;
            this.#checkpointPrevious = this.#previousAssimilated;
            this.#checkpointLatest = this.#latestAssimilated;
            this.#checkpointDirectionX = this.#directionX;
            this.#checkpointDirectionY = this.#directionY;
            this.#checkpointManeuverSamples = this.#maneuverSamples;
            this.#checkpointManeuverDurationMs = this.#maneuverDurationMs;
        }
        if (!this.#filter.update(this.#latest, this.#measurementInflation)) {
            // Retain the prior so a correction at this timestamp can still recover its history
            this.#restoreMetadata();
            this.#failedTimeStamp = sample.timeStamp;
            return;
        }
        this.#filterSamples = this.#checkpointSamples + 1;
        this.#previousAssimilated = this.#checkpointLatest;
        this.#latestAssimilated = this.#latest;
        this.#failedTimeStamp = null;
    }
    predict(now, horizonMs) {
        const projection = this.#project(now, horizonMs);
        if (projection === null) {
            return null;
        }
        const { x, y, endX, endY } = projection;
        return Object.freeze({
            generatedAt: now,
            points: Object.freeze([
                Object.freeze({ x, y, offsetMs: 0 }),
                Object.freeze({ x: endX, y: endY, offsetMs: horizonMs }),
            ]),
        });
    }
    intersectRect(now, horizonMs, rect) {
        assertRect(rect);
        const projection = this.#project(now, horizonMs);
        if (projection === null) {
            return null;
        }
        const { latest, dx, dy, dt, ageMs, x, y } = projection;
        const interval = lineRectInterval(latest, dx, dy, rect, dt);
        if (interval === null) {
            return null;
        }
        const [entryMs, exitMs] = interval;
        const offsetMs = Math.max(0, entryMs - ageMs);
        if (exitMs < ageMs || offsetMs > horizonMs || !Number.isFinite(offsetMs)) {
            return null;
        }
        return {
            offsetMs,
            point: offsetMs === 0
                ? clampPointToRect(x, y, rect)
                : clampPointToRect(latest.x + displacement(dx, dt, entryMs), latest.y + displacement(dy, dt, entryMs), rect),
        };
    }
    #project(now, horizonMs) {
        if (!Number.isFinite(now) || !Number.isFinite(horizonMs) || horizonMs <= 0) {
            throw new RangeError('Prediction time must be finite and horizonMs must be finite and positive.');
        }
        const previous = this.#previous;
        const latest = this.#latest;
        if (previous === null || latest === null) {
            return null;
        }
        const inputAgeMs = now - latest.timeStamp;
        if (inputAgeMs < 0 || inputAgeMs >= this.#maxSampleAgeMs) {
            return null;
        }
        const estimate = this.#failedTimeStamp === null ? this.#filter.state() : null;
        const bootstrap = estimate !== null &&
            this.#filterSamples === 2 &&
            this.#previousAssimilated !== null &&
            this.#latestAssimilated !== null;
        const origin = bootstrap ? this.#latestAssimilated : latest;
        const preceding = bootstrap ? this.#previousAssimilated : previous;
        if (origin === null || preceding === null) {
            return null;
        }
        const sampled = estimate === null || bootstrap;
        const anchor = sampled || this.#latestAssimilated === null
            ? bootstrap && this.#positionAnchor === 'measured'
                ? latest
                : origin
            : this.#positionAnchor === 'measured'
                ? latest
                : { timeStamp: this.#latestAssimilated.timeStamp, x: estimate.x, y: estimate.y };
        const ageMs = now - anchor.timeStamp;
        const dt = sampled ? origin.timeStamp - preceding.timeStamp : 1;
        const dx = sampled ? origin.x - preceding.x : estimate.vx;
        const dy = sampled ? origin.y - preceding.y : estimate.vy;
        const vx = dx / dt;
        const vy = dy / dt;
        const x = anchor.x + displacement(dx, dt, ageMs);
        const y = anchor.y + displacement(dy, dt, ageMs);
        const endX = x + displacement(dx, dt, horizonMs);
        const endY = y + displacement(dy, dt, horizonMs);
        if (![vx, vy, x, y, endX, endY].every((value) => Number.isFinite(value))) {
            return null;
        }
        return { latest: anchor, dx, dy, dt, ageMs, x, y, endX, endY };
    }
    reset() {
        this.#resetFilter();
        this.#previous = null;
        this.#latest = null;
    }
    #restoreMetadata() {
        this.#filterSamples = this.#checkpointSamples;
        this.#previousAssimilated = this.#checkpointPrevious;
        this.#latestAssimilated = this.#checkpointLatest;
        this.#directionX = this.#checkpointDirectionX;
        this.#directionY = this.#checkpointDirectionY;
        this.#maneuverSamples = this.#checkpointManeuverSamples;
        this.#maneuverDurationMs = this.#checkpointManeuverDurationMs;
    }
    #resetFilter() {
        this.#filter.reset();
        this.#filterSamples = 0;
        this.#previousAssimilated = null;
        this.#latestAssimilated = null;
        this.#checkpointSamples = 0;
        this.#checkpointPrevious = null;
        this.#checkpointLatest = null;
        this.#failedTimeStamp = null;
        this.#directionX = 0;
        this.#directionY = 0;
        this.#maneuverSamples = 0;
        this.#maneuverDurationMs = 0;
        this.#checkpointDirectionX = 0;
        this.#checkpointDirectionY = 0;
        this.#checkpointManeuverSamples = 0;
        this.#checkpointManeuverDurationMs = 0;
    }
}
