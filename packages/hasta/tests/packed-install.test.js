import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('the packed vanilla/core package installs and imports without any framework peers', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hasta-install-'));

  try {
    const [packed] = JSON.parse(
      execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], {
        cwd: new URL('..', import.meta.url),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );

    writeFileSync(
      join(directory, 'package.json'),
      JSON.stringify({ name: 'hasta-consumer', private: true, type: 'module' }),
    );
    execFileSync(
      'npm',
      [
        'install',
        '--offline',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        join(directory, packed.filename),
      ],
      {
        cwd: directory,
        stdio: 'pipe',
      },
    );

    for (const name of ['react', 'vue', 'svelte']) {
      assert.equal(existsSync(join(directory, 'node_modules', name)), false);
    }

    const manifest = JSON.parse(
      readFileSync(join(directory, 'node_modules/hasta/package.json'), 'utf8'),
    );

    assert.equal(manifest.type, 'module');

    for (const entry of ['.', './core', './vanilla', './react', './vue', './svelte']) {
      assert.ok(manifest.exports[entry].types.endsWith('.d.ts'));
      assert.ok(manifest.exports[entry].import.endsWith('.js'));
    }

    assert.ok(
      packed.files.every((file) => file.path === 'package.json' || file.path.startsWith('dist/')),
    );
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      import * as root from 'hasta';
      import * as vanilla from 'hasta/vanilla';
      import { ConstantVelocityPredictor } from 'hasta/core';
      assert.equal(root.createHasta, vanilla.createHasta);
      assert.equal(typeof ConstantVelocityPredictor, 'function');
      const controller = vanilla.createHastaController();
      controller.destroy();
    `,
      ],
      { cwd: directory, stdio: 'pipe' },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
