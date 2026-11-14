export function assertPoint(point) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
        throw new RangeError('Point coordinates must be finite.');
    }
}
export function assertRect(rect) {
    if (!Number.isFinite(rect.minX) ||
        !Number.isFinite(rect.minY) ||
        !Number.isFinite(rect.maxX) ||
        !Number.isFinite(rect.maxY) ||
        rect.minX > rect.maxX ||
        rect.minY > rect.maxY) {
        throw new RangeError('Rectangle bounds must be finite and ordered.');
    }
}
