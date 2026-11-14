import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';

import { useHasta, useHastaTarget } from '@66hex/hasta/react';
import { useHasta as useSolidHasta, useHastaTarget as useSolidTarget } from '@66hex/hasta/solid';
import { useHasta as createVueHasta, useHastaTarget as createVueTarget } from '@66hex/hasta/vue';
import { createElement } from 'react';
import { renderToString as renderReact } from 'react-dom/server';
import { renderToString as renderSolid } from 'solid-js/web';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { createSSRApp, h } from 'vue';
import { renderToString as renderVue } from 'vue/server-renderer';

function ReactConsumer() {
  const hasta = useHasta({ debug: true });

  const target = useHastaTarget(hasta, {
    when: { type: 'intersects', withinMs: 100 },
    onPredict() {},
  });

  assert.equal(hasta.getDebugSnapshot(), null);

  return createElement('button', { ref: target.ref }, 'React consumer');
}

assert.match(renderReact(createElement(ReactConsumer)), /React consumer/u);

const app = createSSRApp({
  setup() {
    const hasta = createVueHasta({ debug: true });

    const target = createVueTarget(hasta, {
      when: { type: 'intersects', withinMs: 100 },
      onPredict() {},
    });

    assert.equal(hasta.getDebugSnapshot(), null);

    return () => h('button', { ref: target.ref }, 'Vue consumer');
  },
});

assert.match(await renderVue(app), /Vue consumer/u);

const source = readFileSync('Consumer.svelte', 'utf8');
const { js } = compile(source, { filename: 'Consumer.svelte', generate: 'server' });

writeFileSync('consumer.mjs', js.code);

const { default: Consumer } = await import('./consumer.mjs');

assert.match(render(Consumer).body, /Svelte consumer/u);

assert.equal('window' in globalThis, false);

assert.equal('document' in globalThis, false);

assert.match(
  renderSolid(() => {
    const hasta = useSolidHasta(() => ({ debug: true }));

    const target = useSolidTarget(
      () => hasta,
      () => ({
        when: { type: 'intersects', withinMs: 100 },
        onPredict() {},
      }),
    );

    assert.equal(hasta.getDebugSnapshot(), null);
    assert.equal(target.getBounds(), null);

    return 'Solid consumer';
  }),
  /Solid consumer/u,
);
