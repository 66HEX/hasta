/** @jsxImportSource solid-js */
import { useHasta, useHastaTarget } from '@66hex/hasta/solid';
import type {
  HastaController,
  IntersectsCondition,
  PredictionEvent,
  TargetBinding,
  TargetOptions,
} from '@66hex/hasta/solid';
import { createRoot, createSignal, Show } from 'solid-js';
import { createStore } from 'solid-js/store';
import { hydrate, render } from 'solid-js/web';

import SolidSSR from './solid-ssr.js';

type Settings = {
  version: number;
  withinMs: number;
  marginPx: number;
  visible: boolean;
  targetKey: number;
  debug: boolean;
  alternate: boolean;
  horizonMs: number;
  maxSampleAgeMs: number;
  once: boolean;
  stableForMs: number;
  cooldownMs: number;
  includeCurrent: boolean;
  predicate: boolean;
  matches: boolean;
  asyncCallback: boolean;
};

const initial: Settings = {
  version: 1,
  withinMs: 120,
  marginPx: 0,
  visible: true,
  targetKey: 0,
  debug: true,
  alternate: false,
  horizonMs: 120,
  maxSampleAgeMs: 100,
  once: false,
  stableForMs: 0,
  cooldownMs: 0,
  includeCurrent: false,
  predicate: false,
  matches: true,
  asyncCallback: false,
};

let update: ((value: Partial<Settings>) => void) | undefined;
let primary: HastaController | undefined;
let alternate: HastaController | undefined;
let active: (() => HastaController) | undefined;
let binding: TargetBinding | undefined;
let dispose: (() => void) | undefined;
const events: { version: number; etaMs: number; signal: AbortSignal }[] = [];
const completions: (() => void)[] = [];
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

function App() {
  const [settings, setSettings] = createSignal(initial);
  update = (value) => setSettings((current) => ({ ...current, ...value }));

  const options = () => ({
    debug: settings().debug,
    horizonMs: settings().horizonMs,
    maxSampleAgeMs: settings().maxSampleAgeMs,
  });

  const first = useHasta(options);
  const second = useHasta(options);
  primary = first;
  alternate = second;
  const controller = () => (settings().alternate ? second : first);
  active = controller;

  const target = useHastaTarget(controller, (): TargetOptions => {
    const current = settings();

    const policy = {
      once: current.once,
      stableForMs: current.stableForMs,
      cooldownMs: current.cooldownMs,
      onPredict(event: PredictionEvent) {
        events.push({
          version: current.version,
          etaMs: event.intersection?.etaMs ?? -1,
          signal: event.signal,
        });

        if (current.asyncCallback) {
          return new Promise<void>((resolve) => {
            completions.push(resolve);
          });
        }
      },
    };

    return current.predicate
      ? { ...policy, when: () => current.matches }
      : {
          ...policy,
          when: {
            type: 'intersects',
            withinMs: current.withinMs,
            marginPx: current.marginPx,
            includeCurrent: current.includeCurrent,
          },
        };
  });

  binding = target;

  return (
    <Show when={settings().visible}>
      <Show when={settings().targetKey + 1} keyed>
        {(key) => (
          <button
            ref={target.ref}
            data-testid="solid-target"
            data-key={key}
            style={{
              position: 'absolute',
              left: '100px',
              top: '100px',
              width: '20px',
              height: '20px',
            }}
          >
            Solid target
          </button>
        )}
      </Show>
    </Show>
  );
}

const element = document.querySelector('#app');

if (!element) {
  throw new Error('Fixture root is missing.');
}

const container = element;

function mount(visible = true) {
  dispose?.();
  dispose = visible ? render(() => <App />, container) : undefined;
}

mount();

function rawFixture() {
  return createRoot((cleanup) => {
    const [configuration, configure] = createStore({ horizonMs: 120, debug: { samples: false } });
    const first = useHasta(configuration);
    const second = useHasta({ debug: true });
    const [selected, select] = createSignal(first);
    const [noise, setNoise] = createSignal(0);
    const [settings, change] = createStore({ withinMs: 120, marginPx: 0, version: 1 });
    const signals: AbortSignal[] = [];
    let abort: (() => void) | undefined;
    let reads = 0;

    const target = useHastaTarget(selected, {
      get when(): IntersectsCondition {
        reads++;

        return { type: 'intersects', withinMs: settings.withinMs, marginPx: settings.marginPx };
      },
      onPredict(event) {
        signals.push(event.signal);
        event.signal.addEventListener('abort', () => {
          noise();
          abort?.();
        });
      },
    });

    const node = document.createElement('button');
    node.style.cssText = 'position:absolute;left:100px;top:100px;width:20px;height:20px';
    document.body.append(node);
    target.ref(node);

    return {
      target,
      node,
      first,
      second,
      change,
      configure,
      signals,
      noise: setNoise,
      reads: () => reads,
      switch: () => select(second),
      abort: (callback: () => void) => {
        abort = callback;
      },
      ownedRef(element: HTMLElement) {
        return createRoot((disposeOwner) => {
          target.ref(element);

          return disposeOwner;
        });
      },
      destroy() {
        abort = undefined;
        cleanup();
        node.remove();
      },
    };
  });
}

const harness = {
  rawFixture,
  mount,
  hydrate(markup: string) {
    dispose?.();
    container.innerHTML = markup;
    const original = container.firstElementChild;
    dispose = hydrate(
      () => (
        <SolidSSR
          onController={(controller) => {
            active = () => controller;
            primary = controller;
            alternate = undefined;
          }}
          onPredict={(event) =>
            events.push({ version: 1, etaMs: event.etaMs, signal: event.signal })
          }
        />
      ),
      container,
    );

    return original === container.firstElementChild;
  },
  update(value: Partial<Settings>) {
    update?.(value);
  },
  settle() {
    for (const complete of completions.splice(0)) {
      complete();
    }
  },
  pointer(time: number, x: number, y = 110) {
    now = time;

    const event = new PointerEvent('pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      buttons: 0,
      clientX: x,
      clientY: y,
      bubbles: true,
    });

    Object.defineProperty(event, 'timeStamp', { value: time });
    document.dispatchEvent(event);
  },
  frame(time = now) {
    now = time;

    for (const [id, callback] of [...frames]) {
      if (frames.delete(id)) {
        callback(now);
      }
    }
  },
  state() {
    return {
      events: events.map(({ version, etaMs, signal }) => ({
        version,
        etaMs,
        aborted: signal.aborted,
      })),
      snapshot: active?.().getDebugSnapshot() ?? null,
      owners: [primary, alternate].map(
        (owner) => owner?.getDebugSnapshot()?.targets.length ?? null,
      ),
      bounds: binding?.getBounds() ?? null,
      pendingFrames: frames.size,
    };
  },
  pause: () => active?.().pause(),
  resume: () => active?.().resume(),
  disconnect: () => active?.().disconnect(),
  connect: () => active?.().connect(),
  invalidUsage() {
    const errors: string[] = [];

    const attempt = (callback: () => void) => {
      try {
        callback();
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    };

    attempt(() => useHasta());
    attempt(() => {
      if (primary) {
        useHastaTarget(primary, { when: () => true, onPredict() {} });
      }
    });
    attempt(() => {
      // @ts-expect-error Intentionally invalid DOM type exercises runtime validation
      binding?.ref(document.createElementNS('http://www.w3.org/2000/svg', 'svg'));
    });
    attempt(() => binding?.update({ when: { type: 'intersects', withinMs: 0 }, onPredict() {} }));
    attempt(() => active?.().updateOptions({ horizonMs: 0 }));

    return errors;
  },
};

declare global {
  interface Window {
    solidHarness: typeof harness;
  }
}

window.solidHarness = harness;
