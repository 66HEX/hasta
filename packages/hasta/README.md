# hasta

Hasta tracks element bounds and predicts pointer movement so you can prefetch data or prepare previews before hover. It includes adapters for vanilla JavaScript, React, Vue, and Svelte.

```sh
npm install @66hex/hasta
```

Run after a button with `id="inbox"` exists:

```ts
import { createHastaController } from '@66hex/hasta/vanilla';

const hasta = createHastaController();
const target = hasta.target({
  when: { type: 'intersects', withinMs: 160 },
  onPredict: ({ etaMs }) => {
    console.log(`Inbox in ${Math.round(etaMs)} ms`);
  },
});

target.ref(document.querySelector<HTMLButtonElement>('#inbox'));
hasta.connect();
```

Call `hasta.destroy()` when removing the view. Keep normal keyboard, touch, and click behavior.

Use `@66hex/hasta/core` for geometry and prediction without a DOM, or `@66hex/hasta/react`, `@66hex/hasta/vue`, and `@66hex/hasta/svelte` for framework adapters. Frameworks are optional peer dependencies; vanilla and core usage requires none.

See the [documentation](https://hasta.madebyhex.com) for API details and examples.
