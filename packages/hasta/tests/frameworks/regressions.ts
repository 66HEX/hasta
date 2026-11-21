import { useHasta as useReactHasta, useHastaTarget as useReactTarget } from '@66hex/hasta/react';
import type { HastaController, TargetBinding } from '@66hex/hasta/react';
import { useHasta as useVueHasta, useHastaTarget as useVueTarget } from '@66hex/hasta/vue';
import type { VueTargetBinding } from '@66hex/hasta/vue';
import { createElement, useEffect } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createApp, h } from 'vue';

const initVueHasta = useVueHasta;
const initVueTarget = useVueTarget;

function waitFrames(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => resolve());
    });
  });
}

function captureErrorMessage(fn: () => void): string | null {
  try {
    fn();

    return null;
  } catch (error) {
    return error instanceof Error ? `${error.name}:${error.message}` : String(error);
  }
}

interface FrameworkRegressionRefs {
  reactTarget: TargetBinding | null;
  vueTarget: VueTargetBinding | null;
  capturedButton: HTMLButtonElement | null;
}

export async function runFrameworkRegressions(
  invokeUndefinedRef: (ref: VueTargetBinding['ref']) => void,
  invokeNumberRef: (ref: VueTargetBinding['ref'], value: number) => void,
) {
  const reactContainer = document.querySelector('#react-root');

  if (!(reactContainer instanceof HTMLElement)) {
    throw new TypeError('Missing React test root.');
  }

  const state: FrameworkRegressionRefs = {
    reactTarget: null,
    vueTarget: null,
    capturedButton: null,
  };

  const controllerRefs: HastaController[] = [];

  function ReactHarness(props: { readonly slot: number }) {
    const controller = useReactHasta({ bounds: 'cached' });

    const target = useReactTarget(controller, {
      when: { type: 'intersects', withinMs: 200 },
      onPredict() {},
    });

    useEffect(() => {
      controllerRefs[props.slot] = controller;
      state.reactTarget = target;
    });

    return createElement('button', {
      ref(element: HTMLButtonElement | null) {
        if (element !== null) {
          state.capturedButton = element;
        }

        target.ref(element);
      },
      style: {
        position: 'fixed',
        left: '20px',
        top: '20px',
        width: '100px',
        height: '40px',
      },
    });
  }

  function ControllerSwitcher(props: { readonly useSecond: boolean }) {
    const first = useReactHasta({ bounds: 'cached' });
    const second = useReactHasta({ bounds: 'cached' });
    const active = props.useSecond ? second : first;

    const target = useReactTarget(active, {
      when: { type: 'intersects', withinMs: 200 },
      onPredict() {},
    });

    state.reactTarget = target;
    controllerRefs[0] = first;
    controllerRefs[1] = second;

    return createElement('button', {
      ref: target.ref,
      style: {
        position: 'fixed',
        left: '20px',
        top: '80px',
        width: '120px',
        height: '40px',
      },
    });
  }

  const root = createRoot(reactContainer);

  flushSync(() => {
    root.render(createElement(ReactHarness, { slot: 0 }));
  });

  // Switch to ControllerSwitcher so target uses stable ref callback
  flushSync(() => {
    root.render(createElement(ControllerSwitcher, { useSecond: false }));
  });

  await waitFrames();

  const foreignDoc = document.implementation.createHTMLDocument('other');
  const foreignButton = foreignDoc.createElement('button');

  const reactInvalidError = captureErrorMessage(() => {
    state.reactTarget?.ref(foreignButton);
  });

  // Switching controller after a rejected ref must still re-attach the original valid DOM node
  let switchError: string | null = null;

  try {
    flushSync(() => {
      root.render(createElement(ControllerSwitcher, { useSecond: true }));
    });
  } catch (error) {
    switchError = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  }

  await waitFrames();

  const switchedRect = state.reactTarget?.getBounds()?.rect ?? null;
  const switchedBoundsWidth = switchedRect ? switchedRect.maxX - switchedRect.minX : null;

  flushSync(() => {
    root.unmount();
  });

  // Vue adapter checks: undefined and primitive refs must raise clean TypeErrors instead of failing 'in' check
  const vueContainer = document.querySelector('#vue-root');

  if (!(vueContainer instanceof HTMLElement)) {
    throw new TypeError('Missing Vue test root.');
  }

  const app = createApp({
    setup() {
      const controller = initVueHasta({ bounds: 'cached' });

      state.vueTarget = initVueTarget(controller, {
        when: { type: 'intersects', withinMs: 200 },
        onPredict() {},
      });

      return () => h('div');
    },
  });

  app.mount(vueContainer);

  const vueUndefinedError = captureErrorMessage(() => {
    if (state.vueTarget !== null) {
      invokeUndefinedRef(state.vueTarget.ref);
    }
  });

  const vueNumberError = captureErrorMessage(() => {
    if (state.vueTarget !== null) {
      invokeNumberRef(state.vueTarget.ref, 42);
    }
  });

  app.unmount();

  return {
    reactHadButton: state.capturedButton !== null,
    reactInvalidError,
    switchError,
    switchedBoundsWidth,
    vueUndefinedError,
    vueNumberError,
  };
}

Object.assign(window, { runFrameworkRegressions });
