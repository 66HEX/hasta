# hasta

A little ahead of the pointer.

Hasta tracks element bounds and predicts mouse movement so you can prefetch data or prepare previews before hover. It includes adapters for vanilla JavaScript, React, Vue, and Svelte.

## Usage

Run after a button with `id="inbox"` exists:

```ts
import { createHastaController } from 'hasta/vanilla';

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

Call `hasta.destroy()` when removing the view. Use predictions for work that can be canceled or safely cached, and keep normal keyboard, touch, and click behavior.

## Development

Requires Node.js 24 or later.

```sh
npm ci
npm run dev
```

The documentation site lives in [`apps/web`](apps/web), and the library in [`packages/hasta`](packages/hasta). Run `npm run build` to build both. To run all checks, install the test browsers with `npm run browsers:install`, then run `npm run check`.
