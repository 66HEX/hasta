import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { cpus, platform, arch } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify, parseArgs } from 'node:util';

import { chromium, firefox, webkit } from 'playwright';

import { benchmarkModels } from './performance.mjs';

const { values } = parseArgs({
  options: {
    results: { type: 'string', default: '/tmp/hasta-comparison/results.json' },
    quick: { type: 'boolean', default: false },
    'memory-only': { type: 'boolean', default: false },
  },
});

const quality = JSON.parse(await readFile(resolve(values.results), 'utf8'));
const models = quality.results.map(({ name, config }) => ({ name, config }));
const root = fileURLToPath(new URL('../../', import.meta.url));
const rounds = values.quick ? 5 : 15;

const previous = values['memory-only']
  ? JSON.parse(await readFile(resolve(dirname(values.results), 'performance.json'), 'utf8'))
  : null;

const environments = previous?.environments ?? [];

if (previous && JSON.stringify(previous.models) !== JSON.stringify(models)) {
  throw new Error('Memory-only measurement requires the same model configurations.');
}

if (!values['memory-only']) {
  console.log('Measuring Node');

  environments.push({ name: 'node', version: process.version, ...benchmarkModels(models, rounds) });

  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;

    if (pathname === '/') {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Hasta benchmark</title>');

      return;
    }

    const path = resolve(root, `.${pathname}`);

    if (!path.startsWith(resolve(root) + sep)) {
      response.writeHead(404).end();

      return;
    }

    try {
      response.setHeader('Content-Type', 'text/javascript');
      response.end(await readFile(path));
    } catch {
      response.writeHead(404).end();
    }
  });

  await new Promise((ready) => {
    server.listen(0, '127.0.0.1', ready);
  });

  try {
    for (const [name, browserType] of Object.entries({ chromium, firefox, webkit })) {
      console.log(`Measuring ${name}`);
      const browser = await browserType.launch();

      try {
        const page = await browser.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/`);

        const measurement = await page.evaluate(
          async (options) => {
            const benchmark = await import('/benchmarks/comparison/performance.mjs');

            return benchmark.benchmarkModels(options.models, options.rounds);
          },
          { models, rounds },
        );

        environments.push({ name, version: browser.version(), ...measurement });
      } finally {
        await browser.close();
      }
    }
  } finally {
    await new Promise((closed) => {
      server.close(closed);
    });
  }
}

console.log('Measuring retained memory in isolated Node processes');

const memory = [];

for (const model of models) {
  for (const sampleMs of [1, 0.125]) {
    const runs = [];

    for (let repeat = 0; repeat < 3; repeat++) {
      const { stdout } = await promisify(execFile)(process.execPath, [
        '--expose-gc',
        fileURLToPath(new URL('./memory.mjs', import.meta.url)),
        JSON.stringify(model.config),
        String(sampleMs),
      ]);

      runs.push(JSON.parse(stdout));
    }

    memory.push({ model: model.name, sampleMs, runs });
  }
}

const output = resolve(dirname(values.results), 'performance.json');

await writeFile(
  output,
  `${JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      timingGeneratedAt:
        previous?.timingGeneratedAt ?? previous?.generatedAt ?? new Date().toISOString(),
      memoryWarmupsRetained: true,
      machine: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
      models,
      environments,
      memory,
    },
    null,
    2,
  )}\n`,
);

console.log(`Saved ${output}`);
