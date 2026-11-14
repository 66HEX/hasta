import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';

import { createModel, isExperimental, summarize } from './evaluate.mjs';
import { loadFilterControl } from './filter-controls.mjs';

const { values } = parseArgs({
  options: {
    output: { type: 'string', default: '/tmp/hasta-stability/performance.json' },
    experiments: { type: 'boolean', default: false },
    control: { type: 'string' },
  },
});

const control = values.control === undefined ? null : await loadFilterControl(values.control);
const baseline = control === null ? 'frozen' : 'control';

const names = values.experiments
  ? [baseline, 'current', 'experimental-robust', 'experimental-adaptive']
  : [baseline, 'current'];

const create = (name) => (name === 'control' ? control.create() : createModel(name));

const samples = Array.from({ length: 1000 }, (_, index) => ({
  x: index * 0.6 + Math.sin(index / 8),
  y: 30 * Math.sin(index / 50),
  timeStamp: index,
}));

const results = Object.fromEntries(
  names.map((name) => [name, { update: [], predict: [], uncertainty: [] }]),
);

let sink = 0;

function update(name) {
  const models = Array.from({ length: 1024 }, () => create(name));
  const start = performance.now();

  for (const model of models) {
    for (const sample of samples) {
      model.update(sample);
    }
  }

  const elapsedMs = performance.now() - start;

  for (const model of models) {
    sink += model.predict(1000, 120).points[1].x;
  }

  return (elapsedMs * 1000) / (models.length * samples.length);
}

function query(name, uncertainty) {
  const model = create(name);

  for (const sample of samples) {
    model.update(sample);
  }

  const calls = 200000;
  const start = performance.now();

  for (let index = 0; index < calls; index++) {
    sink += uncertainty
      ? model.uncertainty(1000, 120).positionStdPx
      : model.predict(1000, 120).points[1].x;
  }

  return ((performance.now() - start) * 1000) / calls;
}

for (let round = 0; round < 12; round++) {
  const order = [...names.slice(round % names.length), ...names.slice(0, round % names.length)];

  for (const name of order) {
    const updated = update(name);
    const predicted = query(name, false);
    const uncertain = isExperimental(name) ? query(name, true) : null;

    if (round >= 3) {
      results[name].update.push(updated);
      results[name].predict.push(predicted);

      if (uncertain !== null) {
        results[name].uncertainty.push(uncertain);
      }
    }
  }
}

const output = resolve(values.output);

const result = {
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  control: control?.name ?? 'fa9ac8d',
  controlCommit: control?.commit ?? 'fa9ac8da5ca593b2cc541eb0007f6d0d190aab06',
  description:
    'Microseconds per call from batch means; 3 warmup rounds, 9 measured rounds, rotating model order. Includes immutable result creation. Not individual-call p95 or full browser interaction latency. Run on an otherwise idle machine.',
  models: Object.fromEntries(
    names.map((name) => [
      name,
      Object.fromEntries(
        Object.entries(results[name]).map(([operation, times]) => [operation, summarize(times)]),
      ),
    ]),
  ),
  sinkFinite: Number.isFinite(sink),
};

await mkdir(dirname(output), { recursive: true });

await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });

console.log(JSON.stringify(result));
