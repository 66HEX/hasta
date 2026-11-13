import { createModel } from './models.mjs';

if (!globalThis.gc) {
  throw new Error('Memory measurements require node --expose-gc.');
}

const config = JSON.parse(process.argv[2]);
const sampleMs = Number(process.argv[3] ?? 1);

const samples = Array.from({ length: Math.ceil(32 / sampleMs) }, (_, index) => ({
  x: index * sampleMs * 0.4,
  y: 10,
  timeStamp: index * sampleMs,
}));

const warmups = [];

for (let index = 0; index < 32; index++) {
  const warmup = createModel(config, index + 1);

  for (const sample of samples) {
    warmup.update(sample);
  }

  warmups.push(warmup);
}

globalThis.gc();

const before = process.memoryUsage();
const models = [];

for (let index = 0; index < 128; index++) {
  const model = createModel(config, index + 1);

  for (const sample of samples) {
    model.update(sample);
  }

  models.push(model);
}

globalThis.gc();

const after = process.memoryUsage();
const buffers = new Set();
const visited = new Set();

function collectBuffers(value) {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- Heap traversal must distinguish primitive leaves from object references
  if (value === null || typeof value !== 'object' || visited.has(value)) {
    return;
  }

  visited.add(value);

  if (ArrayBuffer.isView(value)) {
    buffers.add(value.buffer);
  } else if (value instanceof ArrayBuffer) {
    buffers.add(value);
  } else {
    for (const child of Object.values(value)) {
      collectBuffers(child);
    }
  }
}

collectBuffers(models[0]);

const ownedArrayBufferBytes = [...buffers].reduce((total, buffer) => total + buffer.byteLength, 0);
const measuredArrayBufferBytes = (after.arrayBuffers - before.arrayBuffers) / models.length;

if (Math.abs(ownedArrayBufferBytes - measuredArrayBufferBytes) > 1) {
  throw new Error('ArrayBuffer accounting disagrees with the retained model graph.');
}

// Keep all warmed and measured states reachable across both GC snapshots
let checksum = 0;

for (const model of [...warmups, ...models]) {
  checksum += model.predict(samples.at(-1).timeStamp, 60).points[1].x;
}

console.log(
  JSON.stringify({
    instances: models.length,
    sampleMs,
    samplesPerInstance: samples.length,
    warmupInstancesRetained: warmups.length,
    checksum,
    ownedArrayBufferBytesPerInstance: ownedArrayBufferBytes,
    heapBytesPerInstance: (after.heapUsed - before.heapUsed) / models.length,
    arrayBufferBytesPerInstance: measuredArrayBufferBytes,
    retainedBytesPerInstance:
      (after.heapUsed - before.heapUsed + after.arrayBuffers - before.arrayBuffers) / models.length,
  }),
);
