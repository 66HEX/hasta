import { execFileSync } from 'node:child_process';
import test from 'node:test';

test('public ESM entry points import without browser globals', () => {
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import assert from 'node:assert/strict';
    assert.equal(typeof window, 'undefined');
    assert.equal(typeof document, 'undefined');
    const root = await import('hasta');
    const core = await import('hasta/core');
    const vanilla = await import('hasta/vanilla');
    const react = await import('hasta/react');
    const vue = await import('hasta/vue');
    const svelte = await import('hasta/svelte');
    assert.equal(root.createHasta, vanilla.createHasta);
    assert.equal(typeof vanilla.createHastaController, 'function');
    for (const adapter of [react, vue, svelte]) assert.equal(typeof adapter.useHasta, 'function');
    const controller = vanilla.createHastaController();
    controller.target({ when: { type: 'intersects', withinMs: 100 }, onPredict() {} });
    controller.destroy();
    assert.equal(root.LinearSpatialIndex, core.LinearSpatialIndex);
    assert.equal(typeof core.firstSegmentRectIntersection, 'function');
    assert.equal(typeof root.createHasta, 'function');
    assert.equal(root.ConstantVelocityPredictor, core.ConstantVelocityPredictor);
    assert.throws(() => root.createHasta(), /requires a document/);
  `,
    ],
    { cwd: new URL('..', import.meta.url), stdio: 'pipe' },
  );
});
