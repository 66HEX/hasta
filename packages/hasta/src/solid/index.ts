import { createEffect, getOwner, onCleanup, onSettled, runWithOwner, untrack } from 'solid-js';
import type { Accessor } from 'solid-js';

import { createHastaController } from '../runtime/controller.js';
import type { HastaController, TargetBinding, TargetOptions } from '../runtime/controller.js';
import type { SubscriptionOptions } from '../runtime/triggers/subscription.js';
import type {
  HastaOptions,
  IntersectionEvent,
  IntersectsCondition,
  PredictionCondition,
  PredictionEvent,
  TrackedElement,
} from '../runtime/types.js';

export type * from '../runtime/public-types.js';

type Reactive<T> = T | Accessor<T>;

type SolidTargetOptions<Condition extends IntersectsCondition | PredictionCondition> =
  SubscriptionOptions & {
    readonly when: Condition;
    readonly onPredict: (
      event: Condition extends PredictionCondition ? PredictionEvent : IntersectionEvent,
    ) => void | Promise<void>;
  };

function read<T extends object>(value: Reactive<T>): T {
  return typeof value === 'function' ? value() : value;
}

function requireOwner(name: string): void {
  if (!getOwner()) {
    throw new Error(`${name} must be called within a Solid component or owned reactive scope.`);
  }
}

function instanceOptions(options: Reactive<HastaOptions>): HastaOptions {
  const input = read(options);

  if (input === null || typeof input !== 'object') {
    return input;
  }

  const value = { ...input };

  if (value.debug !== null && typeof value.debug === 'object' && !Array.isArray(value.debug)) {
    value.debug = { ...value.debug };
  }

  return value;
}

function targetOptions(options: Reactive<TargetOptions>): TargetOptions {
  const input = read(options);

  if (input === null || typeof input !== 'object') {
    return input;
  }

  const value = { ...input };

  if (typeof value.when !== 'function') {
    value.when = { ...value.when };
  }

  return value;
}

export function useHasta(options: Reactive<HastaOptions> = {}): HastaController {
  requireOwner('useHasta');
  const controller = untrack(() => createHastaController(instanceOptions(options)));
  let disposed = false;

  onCleanup(() => {
    disposed = true;
    untrack(() => controller.destroy());
  });
  createEffect(
    () => instanceOptions(options),
    (next) => {
      if (!disposed) {
        controller.updateOptions(next);
      }
    },
  );
  onSettled(() => {
    if (!disposed) {
      controller.connect();
    }
  });

  return controller;
}

export function useHastaTarget<const Condition extends IntersectsCondition | PredictionCondition>(
  controller: Reactive<HastaController>,
  options: Reactive<SolidTargetOptions<Condition>>,
): TargetBinding;
export function useHastaTarget(
  controller: Reactive<HastaController>,
  options: Reactive<NoInfer<TargetOptions>>,
): TargetBinding;
export function useHastaTarget(
  controller: Reactive<HastaController>,
  options: Reactive<TargetOptions>,
): TargetBinding {
  requireOwner('useHastaTarget');
  let owner = untrack(() => read(controller));
  let binding = untrack(() => owner.target(targetOptions(options)));
  let node: TrackedElement | null = null;
  let disposed = false;
  let attachmentRevision = 0;
  let pendingAttach: (() => void) | null = null;

  function destroy(): void {
    if (disposed) {
      return;
    }

    disposed = true;
    attachmentRevision++;
    pendingAttach = null;
    node = null;
    untrack(() => binding.destroy());
  }

  onCleanup(destroy);
  onSettled(() => {
    const attach = pendingAttach;
    pendingAttach = null;
    attach?.();
  });
  createEffect(
    () => [read(controller), targetOptions(options)] as const,
    ([nextOwner, nextOptions]) => {
      if (disposed) {
        return;
      }

      if (nextOwner === owner) {
        binding.update(nextOptions);

        return;
      }

      const replacement = nextOwner.target(nextOptions);

      try {
        if (pendingAttach === null) {
          replacement.ref(node);
        }
      } catch (error) {
        replacement.destroy();
        throw error;
      }

      const previous = binding;
      binding = replacement;
      owner = nextOwner;
      previous.destroy();
    },
  );

  return Object.freeze({
    ref(element: TrackedElement | null) {
      if (disposed) {
        untrack(() => binding.ref(element));

        return;
      }

      const previousNode = node;
      const previousBinding = binding;
      const previousRevision = attachmentRevision;
      const version = ++attachmentRevision;

      const elementOwner = getOwner();
      const deferred = element !== null && element?.ownerDocument?.defaultView === null;

      node = element;

      const registerCleanup = () => {
        if (element !== null && elementOwner) {
          onCleanup(() => {
            if (!disposed && version === attachmentRevision) {
              attachmentRevision++;
              node = null;
              untrack(() => binding.ref(null));
            }
          });
        }
      };

      try {
        if (deferred) {
          if (
            !(element instanceof globalThis.HTMLElement || element instanceof globalThis.SVGElement)
          ) {
            throw new TypeError('Target refs require an HTMLElement, SVGElement, or null.');
          }

          const attach = () => {
            if (!disposed && version === attachmentRevision) {
              binding.ref(element);
            }
          };

          pendingAttach = attach;
          queueMicrotask(() => {
            if (pendingAttach === attach) {
              pendingAttach = null;
              attach();
            }

            if (!disposed && version === attachmentRevision && elementOwner) {
              runWithOwner(elementOwner, registerCleanup);
            }
          });
        } else {
          untrack(() => binding.ref(element));

          if (element !== null && elementOwner) {
            queueMicrotask(() => {
              if (!disposed && version === attachmentRevision) {
                runWithOwner(elementOwner, registerCleanup);
              }
            });
          }
        }
      } catch (error) {
        if (version === attachmentRevision && binding === previousBinding) {
          attachmentRevision = previousRevision;
          node = previousNode;
        }

        throw error;
      }
    },
    update: (next: TargetOptions) => untrack(() => binding.update(next)),
    getBounds: () => binding.getBounds(),
    invalidate: () => binding.invalidate(),
    destroy,
  });
}
