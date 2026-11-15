import type { DebugOptions, DebugSnapshot } from './debug/types.js';
import { createHasta } from './engine.js';
import {
  debugConfiguration,
  debugOptionEnabled,
  normalizeHastaOptions,
  normalizeIntersectsCondition,
} from './options.js';
import type { NormalizedHastaOptions as Configuration } from './options.js';
import { normalizeSubscriptionOptions } from './triggers/subscription.js';
import type { SubscriptionOptions } from './triggers/subscription.js';
import type {
  BoundsSnapshot,
  Hasta,
  HastaOptions,
  IntersectionEvent,
  IntersectsCondition,
  PredictionCondition,
  PredictionEvent,
  TrackedTarget,
} from './types.js';

export interface IntersectionTargetOptions extends SubscriptionOptions {
  readonly when: IntersectsCondition;
  readonly onPredict: (event: IntersectionEvent) => void | Promise<void>;
}

export interface PredictionTargetOptions extends SubscriptionOptions {
  readonly when: PredictionCondition;
  readonly onPredict: (event: PredictionEvent) => void | Promise<void>;
}

export type TargetOptions = IntersectionTargetOptions | PredictionTargetOptions;

export interface TargetBinding {
  ref(this: void, element: HTMLElement | null): void;
  update(options: TargetOptions): void;
  getBounds(): BoundsSnapshot | null;
  invalidate(): void;
  destroy(): void;
}

export interface HastaController {
  invalidate(): void;
  connect(): void;
  disconnect(): void;
  updateOptions(options: HastaOptions): void;
  target(options: IntersectionTargetOptions): TargetBinding;
  target(options: PredictionTargetOptions): TargetBinding;
  target(options: TargetOptions): TargetBinding;
  setDebug(options: boolean | DebugOptions): void;
  getDebugSnapshot(): DebugSnapshot | null;
  pause(): void;
  resume(): void;
  destroy(): void;
}

type TargetConfiguration = TargetOptions & Required<SubscriptionOptions>;

type BindingState = {
  element: HTMLElement | null;
  options: TargetConfiguration;
  target: TrackedTarget | null;
  unsubscribe: (() => void) | null;
};

function targetConfiguration(options: TargetOptions): TargetConfiguration {
  if (options === null || typeof options !== 'object' || typeof options.onPredict !== 'function') {
    throw new TypeError('A target requires an onPredict callback.');
  }

  const subscription = normalizeSubscriptionOptions(options);

  if (isPredictionTarget(options)) {
    return { when: options.when, onPredict: options.onPredict, ...subscription };
  }

  return {
    when: normalizeIntersectsCondition(options.when),
    onPredict: options.onPredict,
    ...subscription,
  };
}

function isPredictionTarget(options: TargetOptions): options is PredictionTargetOptions {
  return typeof options.when === 'function';
}

function sameRule(a: TargetConfiguration, b: TargetConfiguration): boolean {
  if (a.once !== b.once || a.stableForMs !== b.stableForMs || a.cooldownMs !== b.cooldownMs) {
    return false;
  }

  if (typeof a.when === 'function' || typeof b.when === 'function') {
    return typeof a.when === 'function' && typeof b.when === 'function';
  }

  return (
    a.when.withinMs === b.when.withinMs &&
    a.when.marginPx === b.when.marginPx &&
    a.when.includeCurrent === b.when.includeCurrent
  );
}

function sameDebug(a: Configuration['debug'], b: Configuration['debug']): boolean {
  if (a === false || b === false) {
    return a === b;
  }

  const previous = a === true ? {} : a;
  const next = b === true ? {} : b;

  return (['bounds', 'trajectory', 'samples', 'intersections', 'labels', 'panel'] as const).every(
    (key) => debugOptionEnabled(previous, key) === debugOptionEnabled(next, key),
  );
}

export function createHastaController(input: HastaOptions = {}): HastaController {
  let current = normalizeHastaOptions(input);
  let engine: Hasta | null = null;
  let destroyed = false;
  let paused = false;
  let connectionRevision = 0;
  const bindings = new Set<BindingState>();
  const targets = new Map<HTMLElement, { handle: TrackedTarget; users: number }>();

  function assertActive(): void {
    if (destroyed) {
      throw new Error('Cannot use a destroyed Hasta controller.');
    }
  }

  function subscribe(binding: BindingState): void {
    const handle = binding.target;

    if (!handle) {
      return;
    }

    const config = binding.options;
    binding.unsubscribe =
      typeof config.when === 'function'
        ? handle.when(
            (context) => {
              const condition = binding.options.when;

              return typeof condition === 'function' && condition(context);
            },
            (event) => {
              const currentOptions = binding.options;

              if (isPredictionTarget(currentOptions)) {
                return currentOptions.onPredict(event);
              }
            },
            config,
          )
        : handle.when(config.when, (event) => binding.options.onPredict(event), config);
  }

  function attach(binding: BindingState): void {
    if (!engine || !binding.element || binding.target) {
      return;
    }

    let shared = targets.get(binding.element);

    if (!shared) {
      shared = { handle: engine.track(binding.element), users: 0 };
      targets.set(binding.element, shared);
    }

    shared.users++;
    binding.target = shared.handle;
    subscribe(binding);
  }

  function detach(binding: BindingState): void {
    const handle = binding.target;
    const unsubscribe = binding.unsubscribe;
    binding.unsubscribe = null;
    binding.target = null;
    const element = binding.element;
    const shared = handle && element ? targets.get(element) : undefined;

    if (shared) {
      shared.users--;

      if (shared.users === 0 && element !== null) {
        targets.delete(element);
      }
    }

    // Remove the engine registration before abort handlers can reattach this element
    if (shared?.users === 0) {
      shared.handle.untrack();
    }

    unsubscribe?.();
  }

  function disconnect(): void {
    connectionRevision++;
    const previous = engine;
    engine = null;
    targets.clear();

    for (const binding of bindings) {
      binding.target = null;
      binding.unsubscribe = null;
    }

    previous?.destroy();
  }

  function connect(): void {
    assertActive();

    if (engine) {
      return;
    }

    connectionRevision++;

    const next = createHasta({
      ...current,
      onError(error) {
        if (current.onError) {
          return current.onError(error);
        }

        (current.document?.defaultView?.console ?? globalThis.console).error(error);
      },
    });

    engine = next;

    try {
      if (paused) {
        next.pause();
      }

      for (const binding of bindings) {
        attach(binding);
      }
    } catch (error) {
      disconnect();
      throw error;
    }
  }

  return Object.freeze({
    invalidate: () => engine?.invalidate(),
    connect,
    disconnect,
    updateOptions(options: HastaOptions) {
      assertActive();
      const next = normalizeHastaOptions(options);

      const restart =
        next.bounds !== current.bounds ||
        next.document !== current.document ||
        next.horizonMs !== current.horizonMs ||
        next.maxSampleAgeMs !== current.maxSampleAgeMs;

      const debugChanged = !sameDebug(next.debug, current.debug);
      const connected = engine !== null;

      if (restart && connected) {
        const document = next.document ?? globalThis.document;
        const window = document?.defaultView;

        if (!window || typeof window.requestAnimationFrame !== 'function') {
          throw new Error('createHasta requires a document with an active browser window.');
        }

        for (const binding of bindings) {
          const element = binding.element;

          if (
            element !== null &&
            (element.ownerDocument !== document || !(element instanceof window.HTMLElement))
          ) {
            throw new TypeError('Target belongs to a different document.');
          }
        }
      }

      current = next;

      if (restart && connected) {
        const version = connectionRevision;
        disconnect();

        if (!destroyed && connectionRevision === version + 1) {
          connect();
        }
      } else if (debugChanged) {
        engine?.setDebug(next.debug);
      }
    },
    target(options: TargetOptions): TargetBinding {
      assertActive();

      const state: BindingState = {
        element: null,
        options: targetConfiguration(options),
        target: null,
        unsubscribe: null,
      };

      let disposed = false;
      let revision = 0;
      let attachmentRevision = 0;

      return Object.freeze({
        ref(element: HTMLElement | null) {
          if (disposed || destroyed) {
            if (element !== null) {
              throw new Error('Cannot attach a destroyed target binding.');
            }

            return;
          }

          if (element === state.element && (element === null || bindings.has(state))) {
            return;
          }

          if (element !== null) {
            const view = element.ownerDocument?.defaultView;

            if (!view || !(element instanceof view.HTMLElement)) {
              throw new TypeError('Target refs require an HTMLElement or null.');
            }

            const document = current.document ?? globalThis.document;

            if (document !== undefined && element.ownerDocument !== document) {
              throw new TypeError('Target belongs to a different document.');
            }
          }

          const version = ++attachmentRevision;
          revision++;
          bindings.delete(state);
          detach(state);

          if (version !== attachmentRevision || disposed || destroyed) {
            return;
          }

          state.element = element;

          if (element) {
            bindings.add(state);
            attach(state);
          }
        },
        update(nextOptions: TargetOptions) {
          assertActive();

          if (disposed) {
            throw new Error('Cannot update a destroyed target binding.');
          }

          const next = targetConfiguration(nextOptions);
          const version = ++revision;
          const unchanged = sameRule(state.options, next);

          const changedPredicate =
            typeof next.when === 'function' && next.when !== state.options.when;

          state.options = next;

          if (!unchanged) {
            const unsubscribe = state.unsubscribe;
            state.unsubscribe = null;
            unsubscribe?.();

            if (!destroyed && !disposed && version === revision) {
              subscribe(state);
            }
          } else if (changedPredicate) {
            state.target?.invalidate();
          }
        },
        getBounds: () => state.target?.getBounds() ?? null,
        invalidate: () => state.target?.invalidate(),
        destroy() {
          if (disposed) {
            return;
          }

          disposed = true;
          revision++;
          attachmentRevision++;
          bindings.delete(state);
          detach(state);
          state.element = null;
        },
      });
    },
    setDebug(value: boolean | DebugOptions) {
      assertActive();
      const debug = debugConfiguration(value);
      current = { ...current, debug };
      engine?.setDebug(debug);
    },
    getDebugSnapshot: () => engine?.getDebugSnapshot() ?? null,
    pause() {
      if (!destroyed) {
        paused = true;
        engine?.pause();
      }
    },
    resume() {
      if (!destroyed) {
        paused = false;
        engine?.resume();
      }
    },
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      disconnect();

      for (const binding of bindings) {
        binding.element = null;
      }

      bindings.clear();
    },
  });
}
