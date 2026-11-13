import { firstSegmentRectIntersection } from '../dist/core/index.js';

const count = Number(process.argv[2] ?? 100_000);

if (!Number.isSafeInteger(count) || count <= 0) {
  throw new RangeError('The case count must be a positive safe integer.');
}

const initialSeed = 0x23ed329;
let seed = initialSeed;
const bits = new DataView(new ArrayBuffer(8));

function random(size) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;

  return seed % size;
}

// Every finite double is an integer multiple of the smallest subnormal double
function exactInteger(value) {
  bits.setFloat64(0, value);
  const high = bits.getUint32(0);
  const exponent = (high >>> 20) & 0x7ff;

  const mantissa =
    (BigInt(high & 0xfffff) << 32n) | BigInt(bits.getUint32(4)) | (exponent === 0 ? 0n : 1n << 52n);

  return (high >>> 31 ? -mantissa : mantissa) << BigInt(exponent === 0 ? 0 : exponent - 1);
}

function exactIntersection(start, end, rect) {
  const x = exactInteger(start.x);
  const y = exactInteger(start.y);
  const dx = exactInteger(end.x) - x;
  const dy = exactInteger(end.y) - y;
  const minX = exactInteger(rect.minX);
  const maxX = exactInteger(rect.maxX);
  const minY = exactInteger(rect.minY);
  const maxY = exactInteger(rect.maxY);

  if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
    return true;
  }

  // Check four edge crossings independently of the production slab clipper
  for (const [position, delta, otherPosition, otherDelta, boundaries, low, high] of [
    [x, dx, y, dy, [minX, maxX], minY, maxY],
    [y, dy, x, dx, [minY, maxY], minX, maxX],
  ]) {
    if (delta === 0n) {
      continue;
    }

    const sign = delta < 0n ? -1n : 1n;
    const denominator = delta * sign;

    for (const boundary of boundaries) {
      const numerator = (boundary - position) * sign;

      if (numerator < 0n || numerator > denominator) {
        continue;
      }

      const other = otherPosition * denominator + otherDelta * numerator;

      if (other >= low * denominator && other <= high * denominator) {
        return true;
      }
    }
  }

  return false;
}

function scenario(index) {
  const scale = 2 ** (random(2020) - 1050);

  if (index % 3 === 0) {
    const n = 2 ** (26 + random(26));

    return {
      start: { x: 0, y: 0 },
      end: { x: n * scale, y: (n - 1) * scale },
      rect: {
        minX: (n - 1) * scale,
        maxX: n * scale,
        minY: 0,
        maxY: (n - 2 + random(2)) * scale,
      },
    };
  }

  const start = { x: (random(2001) - 1000) * scale, y: (random(2001) - 1000) * scale };
  const end = { x: (random(2001) - 1000) * scale, y: (random(2001) - 1000) * scale };
  const rect = { minX: (random(2001) - 1000) * scale, minY: (random(2001) - 1000) * scale };
  rect.maxX = rect.minX + random(1000) * scale;
  rect.maxY = rect.minY + random(1000) * scale;

  return { start, end, rect };
}

const started = performance.now();
let hits = 0;
let mismatches = 0;
const examples = [];

for (let index = 0; index < count; index++) {
  const { start, end, rect } = scenario(index);
  const expected = exactIntersection(start, end, rect);
  const hit = firstSegmentRectIntersection(start, end, rect);
  const actual = hit !== null;

  if (expected) {
    hits++;
  }

  if (actual !== expected) {
    mismatches++;

    if (examples.length < 10) {
      examples.push({ index, start, end, rect, expected, hit });
    }
  }
}

console.log(
  JSON.stringify(
    {
      seed: initialSeed,
      cases: count,
      hits,
      mismatches,
      examples,
      durationMs: Math.round(performance.now() - started),
    },
    null,
    2,
  ),
);

if (mismatches > 0) {
  process.exitCode = 1;
}
