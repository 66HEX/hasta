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
    const root = await import('@66hex/hasta');
    const core = await import('@66hex/hasta/core');
    const vanilla = await import('@66hex/hasta/vanilla');
    const react = await import('@66hex/hasta/react');
    const vue = await import('@66hex/hasta/vue');
    const svelte = await import('@66hex/hasta/svelte');
    const solid = await import('@66hex/hasta/solid');
    assert.equal(root.createHasta, vanilla.createHasta);
    assert.equal(typeof vanilla.createHastaController, 'function');
    for (const adapter of [react, vue, svelte, solid]) assert.equal(typeof adapter.useHasta, 'function');
    const controller = vanilla.createHastaController();
    controller.target({ when: { type: 'intersects', withinMs: 100 }, onPredict() {} });
    controller.destroy();
    assert.equal(root.LinearSpatialIndex, core.LinearSpatialIndex);
    assert.equal(typeof core.firstSegmentRectIntersection, 'function');
    assert.equal(typeof root.createHasta, 'function');
    assert.equal(root.KalmanPredictor, core.KalmanPredictor);
    assert.throws(() => root.createHasta(), /requires a document/);
  `,
    ],
    { cwd: new URL('..', import.meta.url), stdio: 'pipe' },
  );
});
