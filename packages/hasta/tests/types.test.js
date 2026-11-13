import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);

for (const [module, resolution] of [
  ['NodeNext', 'NodeNext'],
  ['ESNext', 'Bundler'],
]) {
  test(`published entrypoint declarations infer callback events with ${resolution} resolution`, () => {
    execFileSync(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '--ignoreConfig',
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        module,
        '--moduleResolution',
        resolution,
        'tests/types/entrypoints.ts',
      ],
      { cwd: new URL('..', import.meta.url), stdio: 'inherit' },
    );
  });
}
