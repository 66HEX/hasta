export function scaledRatio(offset, scale, delta) {
    const ratio = offset / delta;
    if (Number.isInteger(ratio) && ratio * delta === offset) {
        return ratio * scale;
    }
    // Multiplying first preserves exact time boundaries before division
    const product = offset * scale;
    if (Number.isFinite(product) && (Math.abs(product) >= 2 ** -1022 || offset === 0)) {
        return product / delta;
    }
    if (Number.isFinite(ratio) && Math.abs(ratio) >= 2 ** -1022) {
        return ratio * scale;
    }
    return offset / (delta / scale);
}
const bits = new DataView(new ArrayBuffer(8));
function binaryParts(value) {
    bits.setFloat64(0, value);
    const high = bits.getUint32(0);
    const exponent = (high >>> 20) & 0x7ff;
    const mantissa = (BigInt(high & 0xfffff) << 32n) | BigInt(bits.getUint32(4)) | (exponent === 0 ? 0n : 1n << 52n);
    return [high >>> 31 ? -mantissa : mantissa, exponent === 0 ? -1074 : exponent - 1075];
}
function compareProducts(a, b, c, d) {
    if ((a === c && b === d) || (a === d && b === c)) {
        return 0;
    }
    const left = a * b;
    const right = c * d;
    const difference = left - right;
    const error = (Math.abs(left) + Math.abs(right)) * Number.EPSILON;
    if (Number.isFinite(difference) && Math.abs(difference) > error) {
        return difference;
    }
    // Resolve nearly equal products exactly, without widening either rectangle edge
    const [am, ae] = binaryParts(a);
    const [bm, be] = binaryParts(b);
    const [cm, ce] = binaryParts(c);
    const [dm, de] = binaryParts(d);
    const shift = ae + be - ce - de;
    const exact = shift >= 0 ? ((am * bm) << BigInt(shift)) - cm * dm : am * bm - ((cm * dm) << BigInt(-shift));
    return exact < 0n ? -1 : exact > 0n ? 1 : 0;
}
/** Clipping rounded endpoints changes the slope, so retain the original direction */
export function lineRectInterval(origin, dx, dy, rect, scale = 1) {
    let enter = null;
    let exit = null;
    for (let axis = 0; axis < 2; axis++) {
        const position = axis === 0 ? origin.x : origin.y;
        const delta = axis === 0 ? dx : dy;
        const min = axis === 0 ? rect.minX : rect.minY;
        const max = axis === 0 ? rect.maxX : rect.maxY;
        const minOffset = min - position;
        const maxOffset = max - position;
        if (!Number.isFinite(delta) || !Number.isFinite(minOffset) || !Number.isFinite(maxOffset)) {
            throw new RangeError('Coordinate differences must remain finite.');
        }
        if (delta === 0) {
            if (position < min || position > max) {
                return null;
            }
            continue;
        }
        const denominator = Math.abs(delta);
        const first = delta > 0 ? minOffset : -maxOffset;
        const second = delta > 0 ? maxOffset : -minOffset;
        if (enter === null || compareProducts(first, enter[1], enter[0], denominator) > 0) {
            enter = [first, denominator];
        }
        if (exit === null || compareProducts(second, exit[1], exit[0], denominator) < 0) {
            exit = [second, denominator];
        }
        if (compareProducts(enter[0], exit[1], exit[0], enter[1]) > 0) {
            return null;
        }
    }
    const entryTime = enter === null ? -Infinity : scaledRatio(enter[0], scale, enter[1]);
    const exitTime = exit === null ? Infinity : scaledRatio(exit[0], scale, exit[1]);
    return [entryTime, Math.max(entryTime, exitTime)];
}
export function clampPointToRect(x, y, rect) {
    return {
        x: Math.max(rect.minX, Math.min(rect.maxX, x)),
        y: Math.max(rect.minY, Math.min(rect.maxY, y)),
    };
}
