import { useHasta as useReactHasta, useHastaTarget as useReactTarget } from '@66hex/hasta/react';
import type { DebugOptions, PredictionEvent, Point, TargetOptions } from '@66hex/hasta/react';
import { useHasta as useSvelteHasta, attachHastaTarget } from '@66hex/hasta/svelte';
import { createHasta, createHastaController } from '@66hex/hasta/vanilla';
import { useHasta as useVueHasta, useHastaTarget as useVueTarget } from '@66hex/hasta/vue';

export function vanillaExample(element: HTMLElement) {
  const engine = createHasta();
  engine.track(element).when({ type: 'intersects', withinMs: 120 }, (event) => {
    event.etaMs.toFixed(0);
  });
  const hasta = createHastaController();

  return hasta.target({
    when: { type: 'intersects', withinMs: 120 },
    onPredict: (event) => {
      event.etaMs.toFixed(0);
    },
  });
}

export function ReactExample() {
  const hasta = useReactHasta();
  useReactTarget(hasta, {
    when: () => true,
    onPredict: (event) => {
      const prediction: PredictionEvent = event;
      prediction.forecast.points[0]?.x.toFixed(0);
      // @ts-expect-error custom predicates do not guarantee an intersection ETA
      event.etaMs.toFixed(0);
    },
  });

  return useReactTarget(hasta, {
    when: { type: 'intersects', withinMs: 120 },
    onPredict: (event) => {
      event.etaMs.toFixed(0);
    },
  });
}

export function DynamicReactTarget({ options }: { options: TargetOptions }) {
  const hasta = useReactHasta();

  return useReactTarget(hasta, options);
}

export function vueSetup() {
  const hasta = useVueHasta(() => ({ debug: true }));

  return useVueTarget(hasta, () => ({
    when: { type: 'intersects', withinMs: 120 },
    onPredict: (event) => {
      event.etaMs.toFixed(0);
    },
  }));
}

export function svelteSetup() {
  const debug: DebugOptions = { labels: true };
  const hasta = useSvelteHasta({ debug });
  const point: Point = { x: 1, y: 2 };

  return {
    point,
    attachment: attachHastaTarget(() => ({
      hasta,
      when: { type: 'intersects', withinMs: 120 },
      onPredict: (event) => {
        event.etaMs.toFixed(0);
      },
    })),
  };
}
