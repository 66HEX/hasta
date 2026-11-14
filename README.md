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

The documentation site lives in [`apps/web`](apps/web), and the library in [`packages/hasta`](packages/hasta). Run `npm run build` to build all workspaces. To run all checks, install the test browsers with `npm run browsers:install`, then run `npm run check`.

The cursor data collector lives in [`apps/lab`](apps/lab). Run `npm run dev:lab` to open it at [localhost:5174](http://localhost:5174). Participants P01–P05 each complete two sessions of 12 practice tasks and 120 collection tasks, using their own mouse or touchpad. Each block has 18 target selections and six gate tasks, followed by a break and a verified compressed JSON backup. Recordings stay in IndexedDB until the participant downloads and sends them. The lab shares the documentation site's styles, fonts, and UI components.

Run `npm run test:lab` for browser and data checks. Build once with `npm run build:lab` and host `apps/lab/dist` on a separate HTTPS origin for collection; keep the build unchanged throughout the study. Prepare received backups with `node apps/lab/scripts/prepare.mjs --out DATASET BACKUP...`. This validates integrity and progress, removes duplicate checkpoints, extracts causal features, and reports recording quality and the native Hasta baseline. The study protocol and coordinator instructions are in the intentionally untracked `docs/lab.md`.

## Deployment

The site runs on Cloudflare Workers at [hasta.madebyhex.com](https://hasta.madebyhex.com). Run `npx wrangler login` once, then `npm run deploy` to build and publish the site, including its Open Graph image. Use `npm run deploy:check` to validate the build without publishing.

The collection app has its own Worker and domain at [hasta-lab.madebyhex.com](https://hasta-lab.madebyhex.com), configured in `wrangler.lab.jsonc`. Run `npm run deploy:lab:check` to validate its deployment and `npm run deploy:lab` to publish it. Participant links can prefill setup, for example `https://hasta-lab.madebyhex.com/?participant=P01&session=1`. Keep the deployed collector unchanged while participants complete the study.
