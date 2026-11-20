import {
  getCurrentInstance,
  onActivated,
  onDeactivated,
  onMounted,
  onUnmounted,
  toValue,
  watchEffect,
} from 'vue';
import type { ComponentPublicInstance, MaybeRefOrGetter } from 'vue';

import { createHastaController } from '../runtime/controller.js';
import type {
  HastaController,
  TargetBinding,
  TargetOptions,
  IntersectionTargetOptions,
  PredictionTargetOptions,
} from '../runtime/controller.js';
import type { HastaOptions, TrackedElement } from '../runtime/types.js';

export type * from '../runtime/public-types.js';

export interface VueTargetBinding extends Omit<TargetBinding, 'ref'> {
  readonly ref: (element: Element | ComponentPublicInstance | null) => void;
}

function requireSetup(name: string): void {
  if (!getCurrentInstance()) {
    throw new Error(`${name} must be called during Vue component setup().`);
  }
}

export function useHasta(options: MaybeRefOrGetter<HastaOptions> = {}): HastaController {
  requireSetup('useHasta');
  const controller = createHastaController(toValue(options));
  watchEffect(() => controller.updateOptions(toValue(options)), { flush: 'post' });
  onMounted(() => controller.connect());
  onActivated(() => controller.connect());
  onDeactivated(() => controller.disconnect());
  onUnmounted(() => controller.destroy());

  return controller;
}

export function useHastaTarget(
  controller: HastaController,
  options: MaybeRefOrGetter<IntersectionTargetOptions>,
): VueTargetBinding;
export function useHastaTarget(
  controller: HastaController,
  options: MaybeRefOrGetter<PredictionTargetOptions>,
): VueTargetBinding;
export function useHastaTarget(
  controller: HastaController,
  options: MaybeRefOrGetter<TargetOptions>,
): VueTargetBinding;
export function useHastaTarget(
  controller: HastaController,
  options: MaybeRefOrGetter<TargetOptions>,
): VueTargetBinding {
  requireSetup('useHastaTarget');
  const binding = controller.target(toValue(options));
  let node: TrackedElement | null = null;
  let deactivated = false;
  watchEffect(() => binding.update(toValue(options)), { flush: 'post' });
  onDeactivated(() => {
    deactivated = true;
    binding.ref(null);
  });
  onActivated(() => {
    deactivated = false;
    binding.ref(node);
  });
  onUnmounted(() => {
    node = null;
    binding.destroy();
  });

  return Object.freeze({
    ...binding,
    ref(element: Element | ComponentPublicInstance | null): void {
      let targetElement: TrackedElement | null = null;

      if (element !== null) {
        const view = 'ownerDocument' in element ? element.ownerDocument?.defaultView : undefined;

        if (!view || !(element instanceof view.HTMLElement || element instanceof view.SVGElement)) {
          throw new TypeError(
            'Hasta target refs require an HTMLElement or SVGElement, not a Vue component instance.',
          );
        }

        targetElement = element;
      }

      if (!deactivated) {
        binding.ref(targetElement);
      }

      node = targetElement;
    },
  });
}
