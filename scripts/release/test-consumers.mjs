import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  assertPackMetadata,
  assertTarball,
  PACKAGE_NAME,
  parseReleaseTag,
  REGISTRY,
} from './contract.mjs';

const root = resolve(import.meta.dirname, '../..');
const manifest = JSON.parse(readFileSync(join(root, 'packages/hasta/package.json'), 'utf8'));
const development = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).devDependencies;
const temporary = mkdtempSync(join(tmpdir(), 'hasta-consumers-'));
const [argument] = process.argv.slice(2);
const version = manifest.version;

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 180_000,
    env: { ...process.env, NODE_PATH: '', NPM_CONFIG_REGISTRY: REGISTRY },
  });
}

function minimumPeer(name) {
  const match = /^>=(\d+(?:\.\d+){0,2}) </u.exec(manifest.peerDependencies[name]);
  assert.ok(match, `Unsupported peer range: ${name}`);

  const [major, minor = '0', patch = '0'] = match[1].split('.');

  return `${major}.${minor}.${patch}`;
}

function smoke(directory, dependencies) {
  writeFileSync(
    join(directory, 'package.json'),
    JSON.stringify({
      name: 'hasta-release-consumer',
      private: true,
      type: 'module',
      dependencies,
    }),
  );
  run(
    'npm',
    ['install', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund'],
    directory,
  );

  const installed = JSON.parse(
    readFileSync(join(directory, 'node_modules', PACKAGE_NAME, 'package.json'), 'utf8'),
  );

  assert.equal(installed.version, version, 'Installed a different Hasta version');
  assert.equal(installed.name, PACKAGE_NAME);
  cpSync(join(import.meta.dirname, 'fixtures/core.mjs'), join(directory, 'core.mjs'));
  run(process.execPath, ['core.mjs'], directory);
}

try {
  let spec;

  if (!argument) {
    const metadata = JSON.parse(
      run(
        'npm',
        [
          'pack',
          '--json',
          '--ignore-scripts',
          '--workspace',
          PACKAGE_NAME,
          '--pack-destination',
          temporary,
        ],
        root,
      ),
    );

    const artifact = assertPackMetadata(metadata, manifest, version);
    spec = join(temporary, artifact.filename);
    assertTarball(readFileSync(spec), artifact, manifest);
  } else if (argument.endsWith('.tgz')) {
    spec = resolve(argument);
    assert.ok(existsSync(spec), 'Tarball does not exist');
  } else {
    assert.equal(
      parseReleaseTag(`v${argument}`),
      version,
      'Registry version must match the checked-out package',
    );
    spec = argument;
  }

  const vanilla = join(temporary, 'vanilla');
  mkdirSync(vanilla);
  smoke(vanilla, { [PACKAGE_NAME]: spec });

  for (const peer of Object.keys(manifest.peerDependencies)) {
    assert.ok(
      !existsSync(join(vanilla, 'node_modules', peer)),
      `Unexpected framework dependency: ${peer}`,
    );
  }

  console.log('Passed: core and vanilla without framework peers');

  for (const profile of ['current', 'minimum']) {
    const directory = join(temporary, profile);
    mkdirSync(directory);

    const peers = Object.fromEntries(
      Object.keys(manifest.peerDependencies).map((name) => [
        name,
        profile === 'minimum' ? minimumPeer(name) : development[name],
      ]),
    );

    peers['react-dom'] = peers.react;
    smoke(directory, {
      [PACKAGE_NAME]: spec,
      ...peers,
      '@types/react': development['@types/react'],
      '@types/react-dom': development['@types/react-dom'],
      typescript: development.typescript,
      vite: development.vite,
    });

    for (const [name, expected] of Object.entries(peers)) {
      const peer = JSON.parse(
        readFileSync(join(directory, 'node_modules', name, 'package.json'), 'utf8'),
      );

      assert.equal(peer.version, expected, `Wrong ${profile} peer: ${name}`);
    }

    cpSync(join(import.meta.dirname, 'fixtures/frameworks.mjs'), join(directory, 'frameworks.mjs'));
    cpSync(
      join(import.meta.dirname, 'fixtures/Consumer.svelte'),
      join(directory, 'Consumer.svelte'),
    );
    run(process.execPath, ['frameworks.mjs'], directory);
    cpSync(join(root, 'packages/hasta/tests/types/entrypoints.ts'), join(directory, 'adapters.ts'));
    writeFileSync(
      join(directory, 'core.ts'),
      "import { KalmanPredictor } from '@66hex/hasta/core';\nimport type { Predictor, Point } from '@66hex/hasta/core';\nexport const predictor: Predictor = new KalmanPredictor();\nexport const point: Point = { x: 0, y: 0 };\n",
    );

    for (const resolution of ['NodeNext', 'Bundler']) {
      run(
        process.execPath,
        [
          join(directory, 'node_modules/typescript/bin/tsc'),
          '--noEmit',
          '--strict',
          '--module',
          resolution === 'NodeNext' ? 'NodeNext' : 'ESNext',
          '--moduleResolution',
          resolution,
          '--target',
          'ES2022',
          '--lib',
          'ES2022,DOM',
          'adapters.ts',
          'core.ts',
        ],
        directory,
      );
    }

    writeFileSync(
      join(directory, 'browser.js'),
      [
        "export { createHasta, createHastaController } from '@66hex/hasta';",
        "export { KalmanPredictor } from '@66hex/hasta/core';",
        "export { createHastaController as vanilla } from '@66hex/hasta/vanilla';",
        "export { useHasta as react } from '@66hex/hasta/react';",
        "export { useHasta as solid, useHastaTarget as solidTarget } from '@66hex/hasta/solid';",
        "export { useHasta as vue } from '@66hex/hasta/vue';",
        "export { useHasta as svelte, attachHastaTarget } from '@66hex/hasta/svelte';",
      ].join('\n'),
    );
    writeFileSync(
      join(directory, 'vite.config.js'),
      "export default { build: { lib: { entry: './browser.js', formats: ['es'], fileName: 'consumer' } } };\n",
    );
    run(process.execPath, [join(directory, 'node_modules/vite/bin/vite.js'), 'build'], directory);
    assert.ok(existsSync(join(directory, 'dist/consumer.js')));
    console.log(`Passed: ${profile} peers, SSR, NodeNext/Bundler declarations, and browser bundle`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
