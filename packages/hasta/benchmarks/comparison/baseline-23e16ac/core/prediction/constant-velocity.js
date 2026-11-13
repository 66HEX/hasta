import { lineRectInterval, clampPointToRect, scaledRatio } from '../line-rect.js';
import { assertRect } from '../validation.js';
function displacement(delta, dt, durationMs) {
    const velocity = delta / dt;
    // Scale the displacement before a subnormal velocity loses significant bits
    return Math.abs(velocity) < 2 ** -1022 && delta !== 0
        ? scaledRatio(delta, durationMs, dt)
        : velocity * durationMs;
}
export class ConstantVelocityPredictor {
    #maxSampleAgeMs;
    #previous = null;
    #latest = null;
    constructor(options = {}) {
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
            if (sample.timeStamp > latest.timeStamp) {
                this.#previous =
                    sample.timeStamp - latest.timeStamp >= this.#maxSampleAgeMs ? null : latest;
            }
        }
        this.#latest = { x: sample.x, y: sample.y, timeStamp: sample.timeStamp };
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
        const ageMs = now - latest.timeStamp;
        if (ageMs < 0 || ageMs >= this.#maxSampleAgeMs) {
            return null;
        }
        const dt = latest.timeStamp - previous.timeStamp;
        const dx = latest.x - previous.x;
        const dy = latest.y - previous.y;
        const vx = dx / dt;
        const vy = dy / dt;
        const x = latest.x + displacement(dx, dt, ageMs);
        const y = latest.y + displacement(dy, dt, ageMs);
        const endX = x + displacement(dx, dt, horizonMs);
        const endY = y + displacement(dy, dt, horizonMs);
        if (![vx, vy, x, y, endX, endY].every((value) => Number.isFinite(value))) {
            return null;
        }
        return { latest, dx, dy, dt, ageMs, x, y, endX, endY };
    }
    reset() {
        this.#previous = null;
        this.#latest = null;
    }
}
