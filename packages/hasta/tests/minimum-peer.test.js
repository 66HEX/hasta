import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

test('the declared minimum Svelte peer supports client imports and server rendering', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const minimumPath = require.resolve('svelte-min/package.json');
  const minimum = JSON.parse(readFileSync(minimumPath, 'utf8'));
  const floor = /^>=(\d+\.\d+(?:\.\d+)?)\s/u.exec(manifest.peerDependencies.svelte)?.[1];
  assert.ok(floor, 'The minimum-peer fixture must match the declared compatibility range');
  assert.equal(minimum.version, floor.split('.').length === 2 ? `${floor}.0` : floor);
  const directory = mkdtempSync(join(tmpdir(), 'hasta-svelte-min-'));

  try {
    const consumer = join(directory, 'node_modules/hasta');
    mkdirSync(consumer, { recursive: true });
    cpSync(join(root, 'dist'), join(consumer, 'dist'), { recursive: true });
    writeFileSync(join(consumer, 'package.json'), JSON.stringify(manifest));
    symlinkSync(dirname(minimumPath), join(directory, 'node_modules/svelte'), 'dir');
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ type: 'module' }));

    for (const conditions of ['node', 'browser']) {
      execFileSync(
        process.execPath,
        [
          `--conditions=${conditions}`,
          '--input-type=module',
          '-e',
          `
          import assert from 'node:assert/strict';
          import { createHastaController } from 'hasta/vanilla';
          import { useHasta, hastaTarget, attachHastaTarget } from 'hasta/svelte';
          assert.equal(typeof useHasta, 'function');
          assert.equal(typeof hastaTarget, 'function');
          const hasta = createHastaController();
          const attachment = attachHastaTarget(() => ({
            hasta, when: { type: 'intersects', withinMs: 120 }, onPredict() {},
          }));
          assert.equal(typeof attachment, 'function');
          hasta.destroy();
          assert.equal(typeof document, 'undefined');
        `,
        ],
        { cwd: directory, stdio: 'pipe' },
      );
    }

    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
        import assert from 'node:assert/strict';
        import { writeFileSync } from 'node:fs';
        import { compile } from 'svelte/compiler';
        import { render } from 'svelte/server';
        const { js } = compile(
          '<script>import { useHasta } from "hasta/svelte"; const hasta = useHasta({ debug: true });</script><p>{hasta.getDebugSnapshot() === null ? "idle" : "connected"}</p>',
          { filename: 'Minimum.svelte', generate: 'server' },
        );
        writeFileSync('minimum.mjs', js.code);
        const { default: Component } = await import('./minimum.mjs');
        assert.match(render(Component).body, /<p>idle<\\/p>/);
        assert.equal(typeof document, 'undefined');
      `,
      ],
      { cwd: directory, stdio: 'pipe' },
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
