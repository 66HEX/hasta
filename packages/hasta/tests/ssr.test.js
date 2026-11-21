import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as nextTurn } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('React renders its adapter on the server without creating browser resources', async () => {
  const { createElement } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { useHasta, useHastaTarget } = await import('@66hex/hasta/react');

  function Component() {
    const hasta = useHasta({ debug: true });

    const target = useHastaTarget(hasta, {
      when: { type: 'intersects', withinMs: 120 },
      onPredict() {},
    });

    assert.equal(hasta.getDebugSnapshot(), null);

    return createElement('button', { ref: target.ref }, 'React SSR');
  }

  assert.match(renderToString(createElement(Component)), /React SSR/u);
  assert.equal(typeof document, 'undefined');
});

test('Vue renders its adapter on the server without connecting the controller', async () => {
  const { createSSRApp, h } = await import('vue');
  const { renderToString } = await import('vue/server-renderer');

  const { useHasta: createVueHasta, useHastaTarget: createVueTarget } =
    await import('@66hex/hasta/vue');

  const app = createSSRApp({
    setup() {
      const hasta = createVueHasta({ debug: true });

      const target = createVueTarget(hasta, {
        when: { type: 'intersects', withinMs: 120 },
        onPredict() {},
      });

      assert.equal(hasta.getDebugSnapshot(), null);

      return () => h('button', { ref: target.ref }, 'Vue SSR');
    },
  });

  assert.match(await renderToString(app), /Vue SSR/u);
  assert.equal(typeof document, 'undefined');
});

test('Svelte server compilation and render skip actions and browser lifecycle work', async () => {
  const { compile } = await import('svelte/compiler');
  const { render } = await import('svelte/server');
  const root = fileURLToPath(new URL('..', import.meta.url));
  const directory = await mkdtemp(resolve(root, '.ssr-'));

  try {
    const source = await readFile(
      new URL('./frameworks/SvelteFixture.svelte', import.meta.url),
      'utf8',
    );

    const { js } = compile(source, { filename: 'SvelteFixture.svelte', generate: 'server' });
    const file = resolve(directory, 'fixture.js');
    await writeFile(file, js.code);
    const { default: Component } = await import(pathToFileURL(file).href);
    assert.match(render(Component).body, /Svelte action target/u);
    assert.equal(typeof document, 'undefined');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('Solid server rendering keeps controllers inert and disposes owned bindings', async () => {
  const { renderToString } = await import('@solidjs/web');
  const { useHasta, useHastaTarget } = await import('@66hex/hasta/solid');
  const owners = [];
  const bindings = [];

  function Component() {
    const hasta = useHasta(() => ({ debug: true }));

    const target = useHastaTarget(
      () => hasta,
      () => ({
        when: { type: 'intersects', withinMs: 120 },
        onPredict() {
          throw new Error('SSR must never predict');
        },
      }),
    );

    assert.equal(hasta.getDebugSnapshot(), null);
    assert.equal(target.getBounds(), null);
    owners.push(hasta);
    bindings.push(target);

    return 'Solid SSR';
  }

  assert.match(renderToString(Component), /Solid SSR/u);
  assert.match(renderToString(Component), /Solid SSR/u);
  assert.notEqual(owners[0], owners[1]);
  await nextTurn();

  for (const owner of owners) {
    assert.throws(() => owner.target({ when: () => true, onPredict() {} }), /destroyed/u);
  }

  for (const binding of bindings) {
    binding.ref(null);
    binding.destroy();
  }

  assert.equal(typeof document, 'undefined');
});

test('Solid helpers reject use without an owner', async () => {
  const { useHasta, useHastaTarget } = await import('@66hex/hasta/solid');
  const { createHastaController } = await import('@66hex/hasta/vanilla');
  const hasta = createHastaController();
  assert.throws(() => useHasta(), /owner|component|root/iu);
  assert.throws(
    () => useHastaTarget(hasta, { when: () => true, onPredict() {} }),
    /owner|component|root/iu,
  );
  hasta.destroy();
});
