import { useHasta, useHastaTarget } from '@66hex/hasta/solid';
import type { HastaController, TargetBinding } from '@66hex/hasta/solid';
import { createRoot, createSignal } from 'solid-js';

function waitFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

interface SolidRegressionRefs {
  targetBinding: TargetBinding | null;
  setController: ((next: HastaController) => void) | null;
  secondController: HastaController | null;
  disposeRoot: (() => void) | null;
}

export async function runSolidRegressions(invokeUndefinedRef: (ref: TargetBinding['ref']) => void) {
  const state: SolidRegressionRefs = {
    targetBinding: null,
    setController: null,
    secondController: null,
    disposeRoot: null,
  };

  const container = document.querySelector('#solid-root');

  if (!(container instanceof HTMLElement)) {
    throw new TypeError('Missing Solid root.');
  }

  createRoot((dispose) => {
    state.disposeRoot = dispose;
    const c1 = useHasta({ bounds: 'cached' });
    const c2 = useHasta({ bounds: 'cached' });
    state.secondController = c2;
    const [active, setActive] = createSignal(c1);
    state.setController = setActive;

    state.targetBinding = useHastaTarget(active, {
      when: { type: 'intersects', withinMs: 200 },
      onPredict() {},
    });
  });

  let undefinedError: string | null = null;

  try {
    if (state.targetBinding !== null) {
      invokeUndefinedRef(state.targetBinding.ref);
    }
  } catch (error) {
    undefinedError = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  }

  // Simulate attaching an inert element (defaultView === null) while pendingAttach is queued
  const inertDoc = document.implementation.createHTMLDocument('inert');
  const inertButton = inertDoc.createElement('button');
  inertButton.style.cssText = 'position:fixed;left:40px;top:40px;width:90px;height:36px;';

  state.targetBinding?.ref(inertButton);

  // Switch controller before queued microtask attaches, then adopt into live document
  let switchError: string | null = null;

  try {
    if (state.secondController !== null) {
      state.setController?.(state.secondController);
    }
  } catch (error) {
    switchError = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  }

  document.adoptNode(inertButton);
  container.append(inertButton);

  await Promise.resolve();
  await Promise.resolve();
  await waitFrames();

  const adoptedRect = state.targetBinding?.getBounds()?.rect ?? null;
  const boundsWidthAfterAdopt = adoptedRect ? adoptedRect.maxX - adoptedRect.minX : null;

  state.disposeRoot?.();

  return {
    undefinedError,
    switchError,
    boundsWidthAfterAdopt,
  };
}

Object.assign(window, { runSolidRegressions });
