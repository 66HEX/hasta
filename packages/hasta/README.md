# hasta

Hasta tracks element bounds and predicts pointer movement so you can prefetch data or prepare previews before hover. It includes adapters for vanilla JavaScript, React, Vue, Svelte, and Solid.

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

Use `@66hex/hasta/core` for geometry and prediction without a DOM, or `@66hex/hasta/react`, `@66hex/hasta/vue`, `@66hex/hasta/svelte`, and `@66hex/hasta/solid` for framework adapters. Frameworks are optional peer dependencies; vanilla and core usage requires none.

See the [documentation](https://hasta.madebyhex.com) for API details and examples.

## Geometry tracking

Since 0.4.0, geometry is cached by default. DOM changes, resize/scroll events and animations invalidate it automatically. After changes outside those signals, including CSSOM edits, call `hasta.invalidate()` (also available on the controller) to refresh all targets in the next frame. `target.invalidate()` refreshes one known target. Cached snapshots keep their actual `measuredAt` timestamp.

Use `createHasta({ bounds: 'frame' })` or `createHastaController({ bounds: 'frame' })` when every active frame must read fresh native bounds. This retains the geometry policy of npm 0.3.0.
