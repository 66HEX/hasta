/** @jsxImportSource solid-js */
import { useHasta, useHastaTarget } from '@66hex/hasta/solid';
import type { HastaController, IntersectionEvent } from '@66hex/hasta/solid';

export default function SolidSSR(props: {
  onController?: (controller: HastaController) => void;
  onPredict?: (event: IntersectionEvent) => void;
}) {
  const hasta = useHasta({ debug: true });

  const target = useHastaTarget(hasta, {
    when: { type: 'intersects', withinMs: 120 },
    onPredict: (event) => props.onPredict?.(event),
  });

  props.onController?.(hasta);

  return (
    <button
      ref={target.ref}
      data-testid="solid-ssr-target"
      style={{ position: 'absolute', left: '100px', top: '100px', width: '20px', height: '20px' }}
    >
      Solid SSR target
    </button>
  );
}
