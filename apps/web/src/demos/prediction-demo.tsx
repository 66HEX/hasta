import { useHasta, useHastaTarget } from 'hasta/react';
import type { HastaController, IntersectionEvent } from 'hasta/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Icon } from '@/components/icon';
import type { IconName } from '@/components/icon';
import { Surface } from '@/components/layout';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

const targets: readonly { name: string; icon: IconName }[] = [
  { name: 'Profile', icon: 'user' },
  { name: 'Inbox', icon: 'mail' },
  { name: 'Settings', icon: 'settings' },
];

const pointerStatusIdleMs = 300;

function DemoTarget({
  controller,
  name,
  icon,
  horizon,
  margin,
  onPredict,
}: {
  controller: HastaController;
  name: string;
  icon: IconName;
  horizon: number;
  margin: number;
  onPredict: (name: string, event: IntersectionEvent) => void;
}) {
  const [predicted, setPredicted] = useState(false);
  const [recent, setRecent] = useState(false);
  const [count, setCount] = useState(0);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(feedbackTimer.current), []);

  const binding = useHastaTarget(controller, {
    when: { type: 'intersects', withinMs: horizon, marginPx: margin, includeCurrent: true },
    onPredict(event) {
      clearTimeout(feedbackTimer.current);
      setPredicted(true);
      setRecent(true);
      setCount((value) => value + 1);
      feedbackTimer.current = setTimeout(() => setRecent(false), 120);
      onPredict(name, event);
      event.signal.addEventListener('abort', () => setPredicted(false), { once: true });
    },
  });

  // oxlint-disable-next-line react/refs -- The adapter exposes a stable callback ref, not a mutable React ref
  const targetRef = binding.ref;

  return (
    <div className="flex w-16 flex-col items-center gap-3 sm:w-18 [&>span]:text-xs [&>span]:text-muted-foreground">
      <div
        ref={targetRef}
        className="grid size-14 place-items-center rounded-xl border bg-card text-card-foreground shadow-xs transition-colors duration-200 ease-out data-[highlighted=true]:border-emerald-600/50 data-[highlighted=true]:bg-emerald-50 data-[highlighted=true]:text-emerald-800 data-[highlighted=true]:duration-0 motion-reduce:transition-none sm:size-16 dark:data-[highlighted=true]:bg-emerald-950 dark:data-[highlighted=true]:text-emerald-200"
        data-predicted={predicted}
        data-highlighted={predicted || recent}
        data-prediction-count={count}
        data-hasta-label={name}
        data-demo-target={name}
      >
        <Icon name={icon} className="size-6" />
      </div>
      <span>{name}</span>
    </div>
  );
}

export function PredictionDemo({
  controls = false,
  overlay = false,
}: {
  controls?: boolean;
  overlay?: boolean;
}) {
  const id = useId();
  const [hovered, setHovered] = useState(false);
  const [moving, setMoving] = useState(false);
  const [globalOverlay, setGlobalOverlay] = useState(false);
  const [horizon, setHorizon] = useState(160);
  const [margin, setMargin] = useState(8);
  const [result, setResult] = useState<{ name: string; eta: number; count: number } | null>(null);
  const controller = useHasta({ horizonMs: horizon, debug: globalOverlay });
  const active = hovered || globalOverlay;

  useEffect(() => {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const stopMoving = () => {
      clearTimeout(idleTimer);
      setMoving(false);
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') {
        return;
      }

      if (event.buttons !== 0 || document.hidden || document.pointerLockElement !== null) {
        stopMoving();

        return;
      }

      clearTimeout(idleTimer);
      setMoving(true);
      idleTimer = setTimeout(stopMoving, pointerStatusIdleMs);
    };

    const resetMouse = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        stopMoving();
      }
    };

    const onPointerOut = (event: PointerEvent) => {
      if (event.relatedTarget === null) {
        resetMouse(event);
      }
    };

    const resetEvents = [
      'pointerdown',
      'pointerup',
      'pointercancel',
      'lostpointercapture',
    ] as const;

    document.addEventListener('pointermove', onMove, { capture: true, passive: true });
    document.addEventListener('pointerout', onPointerOut, { capture: true, passive: true });

    for (const name of resetEvents) {
      document.addEventListener(name, resetMouse, { capture: true, passive: true });
    }

    window.addEventListener('blur', stopMoving);
    window.addEventListener('pagehide', stopMoving);
    document.addEventListener('visibilitychange', stopMoving);
    document.addEventListener('pointerlockchange', stopMoving);

    return () => {
      clearTimeout(idleTimer);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerout', onPointerOut, true);

      for (const name of resetEvents) {
        document.removeEventListener(name, resetMouse, true);
      }

      window.removeEventListener('blur', stopMoving);
      window.removeEventListener('pagehide', stopMoving);
      document.removeEventListener('visibilitychange', stopMoving);
      document.removeEventListener('pointerlockchange', stopMoving);
    };
  }, []);

  const onPredict = useCallback((name: string, event: IntersectionEvent) => {
    setResult((current) => ({
      name,
      eta: Math.round(event.etaMs),
      count: (current?.count ?? 0) + 1,
    }));
  }, []);

  useEffect(() => {
    if (active) {
      controller.resume();
    } else {
      controller.pause();
    }
  }, [active, controller]);

  return (
    <figure data-demo="prediction">
      <Surface>
        <Card>
          <CardContent>
            <div
              data-demo-stage=""
              className="relative h-76 overflow-hidden"
              onPointerEnter={() => setHovered(true)}
              onPointerLeave={() => setHovered(false)}
            >
              <div
                data-demo-pointer-status=""
                data-live={moving}
                className="group/pointer-status pointer-events-none absolute top-0 left-0 flex items-center gap-2 type-display text-xs text-muted-foreground"
              >
                <span
                  aria-hidden="true"
                  data-pointer-dot=""
                  className="size-1.5 shrink-0 scale-75 rounded-full bg-muted-foreground/50 transition-[background-color,scale] duration-150 ease-out group-data-[live=true]/pointer-status:scale-100 group-data-[live=true]/pointer-status:bg-emerald-600 motion-reduce:transition-none"
                />
                <span className="grid">
                  <span
                    aria-hidden={moving}
                    data-pointer-idle=""
                    className="col-start-1 row-start-1 whitespace-nowrap transition-[opacity,translate,filter] duration-150 ease-out group-data-[live=true]/pointer-status:-translate-y-1 group-data-[live=true]/pointer-status:opacity-0 group-data-[live=true]/pointer-status:blur-[2px] motion-reduce:translate-y-0 motion-reduce:blur-none motion-reduce:transition-none"
                  >
                    Idle
                  </span>
                  <span
                    aria-hidden={!moving}
                    data-pointer-live=""
                    className="col-start-1 row-start-1 translate-y-1 whitespace-nowrap opacity-0 blur-[2px] transition-[opacity,translate,filter] duration-150 ease-out group-data-[live=true]/pointer-status:translate-y-0 group-data-[live=true]/pointer-status:opacity-100 group-data-[live=true]/pointer-status:blur-none motion-reduce:translate-y-0 motion-reduce:blur-none motion-reduce:transition-none"
                  >
                    Tracking
                  </span>
                </span>
              </div>
              <div className="absolute top-24 left-1/2 flex -translate-x-1/2 gap-5 sm:gap-8">
                {targets.map((target) => (
                  <DemoTarget
                    key={target.name}
                    controller={controller}
                    {...target}
                    horizon={horizon}
                    margin={margin}
                    onPredict={onPredict}
                  />
                ))}
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <div className="flex w-full flex-col gap-4">
              {controls && (
                <div className="grid grid-cols-2 gap-6 text-xs text-muted-foreground">
                  <div>
                    <div className="mb-3 flex justify-between gap-2">
                      <span id={`${id}-horizon-label`}>Look ahead</span>
                      <output className="font-mono font-medium text-foreground">
                        {horizon} ms
                      </output>
                    </div>
                    <Slider
                      aria-labelledby={`${id}-horizon-label`}
                      min={60}
                      max={400}
                      step={10}
                      value={[horizon]}
                      onValueChange={(values) => setHorizon(values[0] ?? 160)}
                    />
                  </div>
                  <div>
                    <div className="mb-3 flex justify-between gap-2">
                      <span id={`${id}-margin-label`}>Target margin</span>
                      <output className="font-mono font-medium text-foreground">{margin} px</output>
                    </div>
                    <Slider
                      aria-labelledby={`${id}-margin-label`}
                      min={0}
                      max={40}
                      step={2}
                      value={[margin]}
                      onValueChange={(values) => setMargin(values[0] ?? 8)}
                    />
                  </div>
                </div>
              )}
              {overlay && (
                <div className="flex items-center justify-between gap-3 text-xs">
                  <label htmlFor={`${id}-overlay`}>Show the library debug overlay</label>
                  <Switch
                    id={`${id}-overlay`}
                    checked={globalOverlay}
                    onCheckedChange={setGlobalOverlay}
                  />
                </div>
              )}
            </div>
          </CardFooter>
        </Card>
      </Surface>
      <figcaption className="p-4 text-center text-xs leading-relaxed text-muted-foreground">
        <output className="flex min-h-5 flex-wrap items-center justify-center gap-2">
          {result ? (
            <>
              <span className="size-1.5 rounded-full bg-emerald-700 dark:bg-emerald-300" />
              {result.name} predicted {result.eta} ms before entry
              <span className="border-l pl-2 text-muted-foreground">
                {result.count} {result.count === 1 ? 'callback' : 'callbacks'}
              </span>
            </>
          ) : (
            <>Move your mouse toward a target.</>
          )}
        </output>
      </figcaption>
    </figure>
  );
}
