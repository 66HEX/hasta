import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

import { pairedInterval } from './statistics.mjs';

const { values } = parseArgs({
  options: {
    results: { type: 'string', default: '/tmp/hasta-comparison/results.json' },
    destination: { type: 'string', default: '/tmp/hasta-comparison/archive' },
  },
});

const resultBytes = await readFile(resolve(values.results));
const result = JSON.parse(resultBytes);
const { rows, ...summary } = result;
const groups = ['all', 'known', 'motion', 'sensor', 'combined'];
const comparisons = [];

for (const reference of ['regression', 'kalman', 'untuned-kalman']) {
  if (!result.results.some((model) => model.name === reference)) {
    continue;
  }

  for (const model of result.results) {
    if (model.name === reference) {
      continue;
    }

    const current = rows.filter((row) => row.model === model.name);
    const baseline = rows.filter((row) => row.model === reference);

    comparisons.push({
      model: model.name,
      reference,
      groups: Object.fromEntries(
        groups.map((group) => {
          const matches = (row) => group === 'all' || row.split === group;

          return [
            group,
            {
              meanDifferencePx:
                model.groups[group].meanErrorPx -
                result.results.find((entry) => entry.name === reference).groups[group].meanErrorPx,
              ...pairedInterval(
                current.filter((row) => matches(row)),
                baseline.filter((row) => matches(row)),
              ),
            },
          ];
        }),
      ),
    });
  }
}

const root = fileURLToPath(new URL('../../', import.meta.url));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashes = {};

async function hashTree(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      await hashTree(path);
    } else if (/\.(?:mjs|js|ts)$/u.test(entry.name)) {
      hashes[relative(root, path)] = sha256(await readFile(path));
    }
  }
}

await hashTree(resolve(root, 'src'));

await hashTree(resolve(root, 'dist'));

await hashTree(resolve(root, 'benchmarks/comparison'));

hashes['benchmarks/runtime.mjs'] = sha256(await readFile(resolve(root, 'benchmarks/runtime.mjs')));

const performanceBytes = await readFile(resolve(dirname(values.results), 'performance.json'));

const runtimeBytes = await readFile(resolve(dirname(values.results), 'runtime.json')).catch(
  (error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  },
);

const provenance = {
  archivedAt: new Date().toISOString(),
  baseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  worktreeDiffSha256: sha256(
    execFileSync('git', ['diff', '--binary', 'HEAD'], {
      cwd: root,
      maxBuffer: 64 * 1024 * 1024,
    }),
  ),
  worktreeStatus: execFileSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' }),
  resultSha256: sha256(resultBytes),
  performanceSha256: sha256(performanceBytes),
  files: hashes,
};

if (runtimeBytes !== null) {
  provenance.runtimeSha256 = sha256(runtimeBytes);
}

const destination = resolve(values.destination);

await mkdir(destination, { recursive: true });

await writeFile(resolve(destination, 'accuracy.json.gz'), gzipSync(resultBytes, { level: 9 }));

await writeFile(
  resolve(destination, 'summary.json'),
  `${JSON.stringify(
    {
      ...summary,
      comparisons,
      rawResults: 'accuracy.json.gz',
    },
    null,
    2,
  )}\n`,
);

await writeFile(resolve(destination, 'performance.json'), performanceBytes);

if (runtimeBytes !== null) {
  await writeFile(resolve(destination, 'runtime.json'), runtimeBytes);
}

await writeFile(
  resolve(destination, 'provenance.json'),
  `${JSON.stringify(provenance, null, 2)}\n`,
);

console.log(`Saved comparison evidence to ${destination}`);
