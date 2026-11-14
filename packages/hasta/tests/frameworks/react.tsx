import { useHasta, useHastaTarget } from '@66hex/hasta/react';
import type { HastaController, PredictionEvent, TargetOptions } from '@66hex/hasta/react';
import { Activity, StrictMode, Suspense, startTransition, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';

type Settings = {
  version: number;
  withinMs: number;
  marginPx: number;
  visible: boolean;
  targetKey: number;
  debug: boolean;
  suspended: boolean;
  alternate: boolean;
  horizonMs: number;
  maxSampleAgeMs: number;
  once: boolean;
  stableForMs: number;
  cooldownMs: number;
  includeCurrent: boolean;
  predicate: boolean;
  asyncCallback: boolean;
};

const initial: Settings = {
  version: 1,
  withinMs: 120,
  marginPx: 0,
  visible: true,
  targetKey: 0,
  debug: true,
  suspended: false,
  alternate: false,
  horizonMs: 120,
  maxSampleAgeMs: 100,
  once: false,
  stableForMs: 0,
  cooldownMs: 0,
  includeCurrent: false,
  predicate: false,
  asyncCallback: false,
};

let update: ((value: Partial<Settings>) => void) | undefined;
let controller: HastaController | undefined;
const events: { version: number; etaMs: number; signal: AbortSignal }[] = [];
const attemptedVersions: number[] = [];
const completions: (() => void)[] = [];
const unresolved = new Promise<void>(() => {});
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
  const [settings, setSettings] = useState(initial);
  update = (value) => setSettings((current) => ({ ...current, ...value }));

  const primary = useHasta({
    debug: settings.debug && !settings.alternate,
    horizonMs: settings.horizonMs,
    maxSampleAgeMs: settings.maxSampleAgeMs,
  });

  const alternate = useHasta({
    debug: settings.debug && settings.alternate,
    horizonMs: settings.horizonMs,
    maxSampleAgeMs: settings.maxSampleAgeMs,
  });

  const hasta = settings.alternate ? alternate : primary;
  controller = hasta;

  const policy = {
    once: settings.once,
    stableForMs: settings.stableForMs,
    cooldownMs: settings.cooldownMs,
    onPredict: (event: PredictionEvent) => {
      events.push({
        version: settings.version,
        etaMs: event.intersection?.etaMs ?? -1,
        signal: event.signal,
      });

      if (settings.asyncCallback) {
        return new Promise<void>((resolve) => {
          completions.push(resolve);
        });
      }
    },
  };

  const options: TargetOptions = settings.predicate
    ? { ...policy, when: () => true }
    : {
        ...policy,
        when: {
          type: 'intersects',
          withinMs: settings.withinMs,
          marginPx: settings.marginPx,
          includeCurrent: settings.includeCurrent,
        },
      };

  const target = useHastaTarget(hasta, options);

  // oxlint-disable-next-line react/refs -- TargetBinding.ref is a stable callback, not a mutable React ref
  const targetRef = target.ref;
  attemptedVersions.push(settings.version);

  if (settings.suspended) {
    throw unresolved;
  }

  return (
    <>
      <output data-testid="version">{settings.version}</output>
      {settings.visible && (
        <button
          key={settings.targetKey}
          ref={targetRef}
          data-testid="target"
          style={{ position: 'absolute', left: 100, top: 100, width: 20, height: 20 }}
        >
          Target
        </button>
      )}
    </>
  );
}

const element = document.querySelector('#app');

if (!element) {
  throw new Error('Fixture root is missing.');
}

const root = createRoot(element);

const mount = (visible = true, hidden = false) =>
  flushSync(() =>
    root.render(
      <StrictMode>
        <Suspense fallback={<p>Loading</p>}>
          <Activity mode={hidden ? 'hidden' : 'visible'}>{visible && <App />}</Activity>
        </Suspense>
      </StrictMode>,
    ),
  );

mount();

const harness = {
  mount,
  settle() {
    for (const complete of completions.splice(0)) {
      complete();
    }
  },
  update(value: Partial<Settings>) {
    flushSync(() => update?.(value));
  },
  suspendVersion(version: number) {
    startTransition(() => update?.({ version, suspended: true }));
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
      snapshot: controller?.getDebugSnapshot(),
      pendingFrames: frames.size,
      attemptedVersions: [...attemptedVersions],
    };
  },
};

declare global {
  interface Window {
    reactHarness: typeof harness;
  }
}

window.reactHarness = harness;
