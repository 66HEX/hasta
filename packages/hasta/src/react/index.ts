'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { createHastaController } from '../runtime/controller.js';
import type { HastaController, TargetBinding, TargetOptions } from '../runtime/controller.js';
import type { HastaOptions, IntersectsCondition, PredictionCondition } from '../runtime/types.js';

const useCommitEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useHasta(options: HastaOptions = {}): HastaController {
  const [controller] = useState(() => createHastaController(options));

  useCommitEffect(() => {
    controller.updateOptions(options);
  });
  useCommitEffect(() => {
    controller.connect();

    return () => controller.disconnect();
  }, [controller]);

  return controller;
}

export function useHastaTarget(
  controller: HastaController,
  options: Extract<TargetOptions, { when: IntersectsCondition }>,
): TargetBinding;
export function useHastaTarget(
  controller: HastaController,
  options: Extract<TargetOptions, { when: PredictionCondition }>,
): TargetBinding;
export function useHastaTarget(controller: HastaController, options: TargetOptions): TargetBinding;
export function useHastaTarget(controller: HastaController, options: TargetOptions): TargetBinding {
  const node = useRef<HTMLElement | null>(null);
  // Configuration is committed below. Abandoned renders must not update live callbacks
  // oxlint-disable-next-line react-hooks/exhaustive-deps -- Options update after commit without recreating the binding
  const binding = useMemo(() => controller.target(options), [controller]);

  const target = useMemo<TargetBinding>(
    () => ({
      ...binding,
      ref(element) {
        node.current = element;
        binding.ref(element);
      },
    }),
    [binding],
  );

  useCommitEffect(() => {
    binding.update(options);
  });
  useCommitEffect(() => {
    binding.ref(node.current);

    return () => binding.ref(null);
  }, [binding]);

  return target;
}

export type * from '../runtime/public-types.js';
