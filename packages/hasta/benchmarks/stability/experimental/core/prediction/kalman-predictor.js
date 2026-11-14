import { lineRectInterval, clampPointToRect, scaledRatio } from '../line-rect.js';
import { assertRect } from '../validation.js';
import { KalmanState } from './kalman-state.js';
export const DEFAULT_ASSIMILATION_INTERVAL_MS = 0;
export const DEFAULT_POSITION_ANCHOR = 'filtered';
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
    #mode;
    #varianceScale;
    #filterSamples = 0;
    #previousAssimilated = null;
    #latestAssimilated = null;
    #checkpointSamples = 0;
    #checkpointPrevious = null;
    #checkpointLatest = null;
    #failedTimeStamp = null;
    #previous = null;
    #latest = null;
    constructor(options = {}, config = {}) {
        /* oxlint-disable typescript/prefer-nullish-coalescing -- Null is invalid input and must reach validation */
        this.#mode = options.mode === undefined ? 'linear' : options.mode;
        this.#varianceScale = options.varianceScale === undefined ? 1 : options.varianceScale;
        /* oxlint-enable typescript/prefer-nullish-coalescing */
        this.#filter = new KalmanState(config, this.#mode);
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
        if (!Number.isFinite(this.#varianceScale) || this.#varianceScale <= 0) {
            throw new RangeError('varianceScale must be finite and positive.');
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
        }
        if (!this.#filter.update(this.#latest)) {
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
    /** Per-axis model covariance, with no guarantee of empirical coverage */
    uncertainty(now, offsetMs = 0) {
        if (!Number.isFinite(now) || !Number.isFinite(offsetMs) || offsetMs < 0) {
            throw new RangeError('Uncertainty time must be finite and offsetMs finite and nonnegative.');
        }
        const latest = this.#latest;
        const assimilated = this.#latestAssimilated;
        if (this.#previous === null ||
            latest === null ||
            assimilated === null ||
            this.#failedTimeStamp !== null ||
            now < latest.timeStamp ||
            now - latest.timeStamp >= this.#maxSampleAgeMs ||
            (this.#positionAnchor === 'measured' &&
                (this.#filterSamples !== 2 || latest.timeStamp !== assimilated.timeStamp))) {
            return null;
        }
        const ageMs = now - assimilated.timeStamp;
        const durationMs = ageMs + offsetMs;
        const estimate = this.#filter.state();
        if (estimate === null ||
            !Number.isFinite(estimate.x + estimate.vx * durationMs) ||
            !Number.isFinite(estimate.y + estimate.vy * durationMs)) {
            return null;
        }
        const projected = this.#filter.projectCovariance(durationMs);
        if (projected === null) {
            return null;
        }
        const positionVariancePx2 = projected.positionVariancePx2 * this.#varianceScale;
        const velocityVariancePx2PerMs2 = projected.velocityVariancePx2PerMs2 * this.#varianceScale;
        if (!Number.isFinite(positionVariancePx2) ||
            !Number.isFinite(velocityVariancePx2PerMs2) ||
            (positionVariancePx2 === 0 && projected.positionVariancePx2 > 0) ||
            (velocityVariancePx2PerMs2 === 0 && projected.velocityVariancePx2PerMs2 > 0)) {
            return null;
        }
        return Object.freeze({
            timeStamp: assimilated.timeStamp,
            ageMs,
            offsetMs,
            positionVariancePx2,
            positionStdPx: Math.sqrt(positionVariancePx2),
            velocityVariancePx2PerMs2,
            calibrated: false,
        });
    }
    diagnostics() {
        const state = this.#filter.diagnostics();
        return Object.freeze({
            ...state,
            covariance: Object.freeze(state.covariance.map((row) => Object.freeze(row))),
            sampleCount: this.#filterSamples,
            latestTimeStamp: this.#latest?.timeStamp ?? null,
            mode: this.#mode,
            varianceScale: this.#varianceScale,
            arithmeticFailure: this.#failedTimeStamp !== null,
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
    }
}
