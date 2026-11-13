import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

function run(tool, args) {
  return spawnSync(process.execPath, [join(root, 'node_modules', tool, 'bin', tool), ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  });
}

test('quality gates reject unsafe code and comment slop, then accept formatted safe code', () => {
  const directory = mkdtempSync(join(root, 'packages/hasta/src/quality-probe-'));
  const file = join(directory, 'probe.ts');

  try {
    writeFileSync(
      file,
      `
// Utilize this robust helper to seamlessly streamline the result
export function slop(value: unknown) {
  const payload = value as unknown as { id: string };
  Promise.resolve(payload.id);
  return [1, 2].filter((item) => item > 0).map((item) => item * 2);
}
export const unsafe: any = JSON.parse('{}');
// oxlint-disable-next-line no-debugger
export const unusedSuppression = 1;
`,
    );

    const rejected = run('oxlint', ['--format', 'json', file]);
    assert.equal(rejected.status, 1, rejected.stderr || rejected.stdout);
    const { diagnostics } = JSON.parse(rejected.stdout);
    const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));

    for (const code of [
      'anti-slop(no-chained-type-assertions)',
      'anti-slop(no-array-filter-map)',
      'no-comment-slop(no-jargon)',
      'typescript(no-explicit-any)',
      'typescript(no-unsafe-assignment)',
      'typescript(no-floating-promises)',
    ]) {
      assert.ok(codes.has(code), `Missing quality gate: ${code}`);
    }

    assert.ok(
      diagnostics.some((diagnostic) => diagnostic.message.includes('Unused oxlint-disable')),
    );

    writeFileSync(file, 'export function double(value:number):number{return value*2}\n');
    const unformatted = run('oxfmt', ['--check', file]);
    assert.equal(unformatted.status, 1, unformatted.stderr || unformatted.stdout);
    const formatted = run('oxfmt', ['--write', file]);
    assert.equal(formatted.status, 0, formatted.stderr || formatted.stdout);
    const first = readFileSync(file, 'utf8');
    const repeated = run('oxfmt', ['--write', file]);
    assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
    assert.equal(readFileSync(file, 'utf8'), first);

    const accepted = run('oxlint', [file]);
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('the formatter sorts Tailwind classes in helpers and custom attributes', () => {
  const result = spawnSync(
    process.execPath,
    [
      join(root, 'node_modules/oxfmt/bin/oxfmt'),
      '--stdin-filepath',
      join(root, 'apps/web/src/sorting-probe.tsx'),
    ],
    {
      cwd: root,
      encoding: 'utf8',
      input: `
export const classes = cn('p-4 flex items-center');
export const variants = cva('text-sm bg-background');
export const conditional = clsx('p-2 grid gap-1');
export const preview = <div tw="p-4 flex text-xl" />;
`,
      timeout: 30_000,
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /cn\('flex items-center p-4'\)/u);
  assert.match(result.stdout, /cva\('bg-background text-sm'\)/u);
  assert.match(result.stdout, /clsx\('grid gap-1 p-2'\)/u);
  assert.match(result.stdout, /tw="flex p-4 text-xl"/u);
});
