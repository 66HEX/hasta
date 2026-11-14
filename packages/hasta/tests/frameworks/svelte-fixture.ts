import { hastaTarget } from '@66hex/hasta/svelte';
import { createHastaController } from '@66hex/hasta/vanilla';
import { flushSync, mount, tick, unmount } from 'svelte';

import Fixture from './SvelteFixture.svelte';

let now = 1000;
let sequence = 0;
const frames = new Map<number, FrameRequestCallback>();

Object.defineProperty(performance, 'now', { configurable: true, value: () => now });

window.requestAnimationFrame = (callback) => {
  frames.set(++sequence, callback);

  return sequence;
};

window.cancelAnimationFrame = (id) => {
  frames.delete(id);
};

const host = document.querySelector('#app');

if (host === null) {
  throw new Error('Fixture root is missing.');
}

const mountFixture = () => mount(Fixture, { target: host });
let app: ReturnType<typeof mountFixture> | null = null;

function mountedFixture() {
  if (app === null) {
    throw new Error('Fixture is not mounted.');
  }

  return app;
}

function start() {
  if (app) {
    throw new Error('Fixture already mounted');
  }

  app = mountFixture();
  flushSync();
}

start();

const harness = {
  createController: createHastaController,
  action: hastaTarget,
  async configure(next: Parameters<NonNullable<typeof app>['configure']>[0]) {
    mountedFixture().configure(next);
    await tick();
  },
  read: () => mountedFixture().read(),
  frame(time = now) {
    now = time;

    for (const [id, callback] of [...frames]) {
      if (frames.delete(id)) {
        callback(now);
      }
    }

    flushSync();
  },
  pointer(time: number, x: number, y = 115) {
    now = time;

    const event = new PointerEvent('pointermove', {
      pointerType: 'mouse',
      pointerId: 1,
      isPrimary: true,
      buttons: 0,
      bubbles: true,
      clientX: x,
      clientY: y,
    });

    Object.defineProperty(event, 'timeStamp', { value: time });
    document.dispatchEvent(event);
  },
  pause: () => mountedFixture().pause(),
  resume: () => mountedFixture().resume(),
  pending: () => frames.size,
  async unmount() {
    const previous = app;
    app = null;

    if (previous) {
      await unmount(previous);
    }

    await tick();
  },
  mount() {
    start();
  },
};

Object.assign(window, { svelteHarness: harness, svelteReady: true });
