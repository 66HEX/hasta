import { onDestroy, onMount } from 'svelte';
import type { Action } from 'svelte/action';
import { fromAction } from 'svelte/attachments';
import type { Attachment } from 'svelte/attachments';

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

export function useHasta(options: HastaOptions = {}): HastaController {
  const hasta = createHastaController(options);
  onMount(() => {
    hasta.connect();
  });
  onDestroy(() => {
    hasta.destroy();
  });

  return hasta;
}

export type HastaActionOptions = TargetOptions & { readonly hasta: HastaController };

function bind(node: TrackedElement, options: HastaActionOptions): TargetBinding {
  const binding = options.hasta.target(options);

  try {
    binding.ref(node);

    return binding;
  } catch (error) {
    binding.destroy();
    throw error;
  }
}

export const hastaTarget: Action<TrackedElement, HastaActionOptions> = (node, options) => {
  let hasta = options.hasta;
  let binding = bind(node, options);
  let destroyed = false;

  return {
    update(next) {
      if (destroyed) {
        return;
      }

      if (next.hasta === hasta) {
        binding.update(next);

        return;
      }

      const replacement = bind(node, next);
      const previous = binding;
      binding = replacement;
      hasta = next.hasta;
      previous.destroy();
    },
    destroy() {
      destroyed = true;
      binding.destroy();
    },
  };
};

function isPredictionTarget(options: TargetOptions): options is PredictionTargetOptions {
  return typeof options.when === 'function';
}

export function attachHastaTarget(
  options: () => IntersectionTargetOptions & { readonly hasta: HastaController },
): Attachment<TrackedElement>;
export function attachHastaTarget(
  options: () => PredictionTargetOptions & { readonly hasta: HastaController },
): Attachment<TrackedElement>;
export function attachHastaTarget(
  options: () => NoInfer<HastaActionOptions>,
): Attachment<TrackedElement>;
export function attachHastaTarget(options: () => HastaActionOptions): Attachment<TrackedElement> {
  return fromAction(hastaTarget, () => {
    // Read option fields inside the attachment effect so in-place state changes are observed
    const value = { ...options() };

    if (!isPredictionTarget(value)) {
      value.when = { ...value.when };
    }

    return value;
  });
}
