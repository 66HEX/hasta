import { useHastaTarget } from '@66hex/hasta/react';
import type { HastaController, IntersectionEvent } from '@66hex/hasta/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Icon } from '@/components/icon';
import type { IconName } from '@/components/icon';
import { Surface } from '@/components/layout';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { PreviewDeck } from '@/demos/preview-deck';
import type { PreviewName } from '@/demos/preview-deck';
import { usePrediction } from '@/lib/prediction';

import './prediction-demo.css';

const targets: readonly { name: PreviewName; icon: IconName }[] = [
  { name: 'Profile', icon: 'user' },
  { name: 'Settings', icon: 'settings' },
];

const pointerStatusIdleMs = 300;

function DemoTarget({
  controller,
  name,
  icon,
  horizon,
  margin,
  stability,
  onPredict,
  onCancel,
  onHover,
  onFocus,
  onSelect,
  active,
  selected,
}: {
  controller: HastaController;
  name: PreviewName;
  icon: IconName;
  horizon: number;
  margin: number;
  stability: number;
  onPredict: (name: PreviewName, event: IntersectionEvent) => void;
  onCancel: (name: PreviewName, signal: AbortSignal) => void;
  onHover: (name: PreviewName | null) => void;
  onFocus: (name: PreviewName | null) => void;
  onSelect: (name: PreviewName) => void;
  active: boolean;
  selected: boolean;
}) {
  const [predicted, setPredicted] = useState(false);
  const [recent, setRecent] = useState(false);
  const [count, setCount] = useState(0);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(feedbackTimer.current), []);

  const binding = useHastaTarget(controller, {
    when: { type: 'intersects', withinMs: horizon, marginPx: margin, includeCurrent: true },
    stableForMs: stability,
    onPredict(event) {
      clearTimeout(feedbackTimer.current);
      setPredicted(true);
      setRecent(true);
      setCount((value) => value + 1);
      feedbackTimer.current = setTimeout(() => setRecent(false), 120);
      onPredict(name, event);
      event.signal.addEventListener(
        'abort',
        () => {
          setPredicted(false);
          onCancel(name, event.signal);
        },
        { once: true },
      );
    },
  });

  // oxlint-disable-next-line react/refs -- The adapter exposes a stable callback ref, not a mutable React ref
  const targetRef = binding.ref;

  return (
    <button
      type="button"
      ref={targetRef}
      className="preview-target"
      aria-label={`Preview ${name}`}
      aria-pressed={selected}
      data-active={active}
      data-predicted={predicted}
      data-highlighted={predicted || recent}
      data-prediction-count={count}
      data-hasta-label={name}
      data-demo-target={name}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') {
          onHover(name);
        }
      }}
      onPointerLeave={() => onHover(null)}
      onFocus={(event) => {
        if (event.currentTarget.matches(':focus-visible')) {
          onFocus(name);
        }
      }}
      onBlur={() => onFocus(null)}
      onClick={() => onSelect(name)}
    >
      <span className="preview-target-icon">
        <Icon name={icon} />
      </span>
      <span>{name}</span>
      <span className="preview-target-mark" aria-hidden="true">
        ↗
      </span>
    </button>
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
  const [moving, setMoving] = useState(false);
  const { controller, horizon, setHorizon, margin, setMargin, debug, setDebug } = usePrediction();
  const [result, setResult] = useState<{ name: string; eta: number; count: number } | null>(null);

  const [anticipated, setAnticipated] = useState<{ name: PreviewName; signal: AbortSignal } | null>(
    null,
  );

  const [hovered, setHovered] = useState<PreviewName | null>(null);
  const [focused, setFocused] = useState<PreviewName | null>(null);
  const [selected, setSelected] = useState<PreviewName | null>(null);
  const [stability, setStability] = useState(0);
  const active = focused ?? hovered ?? anticipated?.name ?? selected;

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

  const onPredict = useCallback((name: PreviewName, event: IntersectionEvent) => {
    setAnticipated({ name, signal: event.signal });
    setResult((current) => ({
      name,
      eta: Math.round(event.etaMs),
      count: (current?.count ?? 0) + 1,
    }));
  }, []);

  const onCancel = useCallback((_name: PreviewName, signal: AbortSignal) => {
    setAnticipated((current) => (current?.signal === signal ? null : current));
  }, []);

  return (
    <figure data-demo="prediction">
      <Surface>
        <Card>
          <CardContent>
            <div
              data-demo-stage=""
              className="prediction-stage"
              data-active-view={active ?? 'none'}
            >
              <div
                data-demo-pointer-status=""
                data-live={moving}
                className="group/pointer-status pointer-events-none absolute top-0 left-0 z-10 flex items-center gap-2 type-display text-xs text-muted-foreground"
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
              <span className="preview-stage-label" aria-hidden="true">
                LIVE PREVIEW
              </span>
              <PreviewDeck active={active} />
              <fieldset className="preview-targets" aria-label="Preview a view">
                {targets.map((target) => (
                  <DemoTarget
                    key={target.name}
                    controller={controller}
                    {...target}
                    horizon={horizon}
                    margin={margin}
                    stability={stability}
                    onPredict={onPredict}
                    onCancel={onCancel}
                    onHover={setHovered}
                    onFocus={setFocused}
                    onSelect={(name) => setSelected((current) => (current === name ? null : name))}
                    active={active === target.name}
                    selected={selected === target.name}
                  />
                ))}
              </fieldset>
            </div>
          </CardContent>
          <CardFooter>
            <div className="flex w-full flex-col gap-4">
              {controls && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 text-xs text-muted-foreground sm:grid-cols-3">
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
                  <div className="col-span-2 sm:col-span-1">
                    <div className="mb-3 flex justify-between gap-2">
                      <span id={`${id}-stability-label`}>Stability</span>
                      <output className="font-mono font-medium text-foreground">
                        {stability} ms
                      </output>
                    </div>
                    <Slider
                      aria-labelledby={`${id}-stability-label`}
                      min={0}
                      max={200}
                      step={10}
                      value={[stability]}
                      onValueChange={(values) => setStability(values[0] ?? 0)}
                    />
                  </div>
                </div>
              )}
              {overlay && (
                <div className="flex items-center justify-between gap-3 text-xs">
                  <label htmlFor={`${id}-overlay`}>Show the library debug overlay</label>
                  <Switch id={`${id}-overlay`} checked={debug} onCheckedChange={setDebug} />
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
            <>Move toward a view. See it before you reach it.</>
          )}
        </output>
      </figcaption>
    </figure>
  );
}
