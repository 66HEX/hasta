import { useHastaTarget } from '@66hex/hasta/react';
import type { HastaController, IntersectionEvent } from '@66hex/hasta/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';

import { Icon } from '@/components/icon';
import type { IconName } from '@/components/icon';
import { Surface } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { PreviewDeck } from '@/demos/preview-deck';
import type { PreviewName } from '@/demos/preview-deck';
import { usePrediction } from '@/lib/prediction';
import { cn } from '@/lib/utils';

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
  cooldown,
  includeCurrent,
  once,
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
  cooldown: number;
  includeCurrent: boolean;
  once: boolean;
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
    when: { type: 'intersects', withinMs: horizon, marginPx: margin, includeCurrent },
    stableForMs: stability,
    cooldownMs: cooldown,
    once,
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
      className={cn(
        'relative flex h-12 min-w-0 cursor-pointer items-center justify-center gap-2 border border-border bg-card px-3 text-xs text-muted-foreground after:absolute after:-inset-x-px after:-bottom-px after:h-0.5 after:origin-left after:scale-x-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring data-[active=true]:text-accent-foreground data-[active=true]:after:scale-x-100 motion-safe:transition-all motion-safe:duration-150 motion-safe:after:transition-all motion-safe:after:duration-150 sm:justify-start',
        name === 'Profile'
          ? 'after:bg-emerald-500 hover:border-emerald-500 hover:shadow-[inset_0_0_30px_0_color-mix(in_oklab,var(--color-emerald-500)_20%,transparent)] dark:hover:shadow-[inset_0_0_30px_0_color-mix(in_oklab,var(--color-emerald-500)_50%,transparent)]'
          : 'after:bg-blue-500 hover:border-blue-500 hover:shadow-[inset_0_0_30px_0_color-mix(in_oklab,var(--color-blue-500)_20%,transparent)] dark:hover:shadow-[inset_0_0_30px_0_color-mix(in_oklab,var(--color-blue-500)_50%,transparent)]',
        (active || predicted || recent) &&
          (name === 'Profile'
            ? 'border-emerald-500 shadow-[inset_0_0_30px_0_color-mix(in_oklab,var(--color-emerald-500)_20%,transparent)] dark:shadow-[inset_0_0_30px_0_color-mix(in_oklab,var(--color-emerald-500)_50%,transparent)]'
            : 'border-blue-500 shadow-[inset_0_0_30px_0_color-mix(in_oklab,var(--color-blue-500)_20%,transparent)] dark:shadow-[inset_0_0_30px_0_color-mix(in_oklab,var(--color-blue-500)_50%,transparent)]'),
      )}
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
      <span className="grid place-items-center">
        <Icon name={icon} className="size-4" />
      </span>
      <span>{name}</span>
      <span className="ml-auto hidden text-muted-foreground sm:block" aria-hidden="true">
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
  const [cooldown, setCooldown] = useState(0);
  const [includeCurrent, setIncludeCurrent] = useState(true);
  const [once, setOnce] = useState(false);
  const [activity, setActivity] = useState(0);
  const active = focused ?? hovered ?? anticipated?.name ?? selected;

  const sliders = [
    {
      key: 'horizon',
      label: 'Look ahead',
      value: horizon,
      min: 60,
      max: 400,
      step: 10,
      unit: 'ms',
      setValue: setHorizon,
      description: 'How far ahead to check for a target.',
    },
    {
      key: 'margin',
      label: 'Target margin',
      value: margin,
      min: 0,
      max: 40,
      step: 2,
      unit: 'px',
      setValue: setMargin,
      description: 'Expand the area around each target.',
    },
    {
      key: 'stability',
      label: 'Stability',
      value: stability,
      min: 0,
      max: 200,
      step: 10,
      unit: 'ms',
      setValue: setStability,
      description: 'Require a sustained match before starting.',
    },
    {
      key: 'cooldown',
      label: 'Cooldown',
      value: cooldown,
      min: 0,
      max: 1000,
      step: 50,
      unit: 'ms',
      setValue: setCooldown,
      description: 'Minimum time between callbacks per target.',
    },
  ];

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

  const resetActivity = () => {
    controller.pause();
    controller.resume();
    setAnticipated(null);
    setSelected(null);
    setResult(null);
    setActivity((value) => value + 1);
  };

  return (
    <figure data-demo="prediction">
      <Surface>
        <Card>
          <CardContent>
            <div
              data-demo-stage=""
              className="relative isolate h-96"
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
                  className="size-1.5 shrink-0 scale-75 rounded-full bg-muted-foreground/50 transition duration-150 ease-out group-data-[live=true]/pointer-status:scale-100 group-data-[live=true]/pointer-status:bg-emerald-500 motion-reduce:transition-none"
                />
                <span className="grid">
                  <span
                    aria-hidden={moving}
                    data-pointer-idle=""
                    className="col-start-1 row-start-1 whitespace-nowrap transition duration-150 ease-out group-data-[live=true]/pointer-status:-translate-y-1 group-data-[live=true]/pointer-status:opacity-0 group-data-[live=true]/pointer-status:blur-xs motion-reduce:translate-y-0 motion-reduce:blur-none motion-reduce:transition-none"
                  >
                    Idle
                  </span>
                  <span
                    aria-hidden={!moving}
                    data-pointer-live=""
                    className="col-start-1 row-start-1 translate-y-1 whitespace-nowrap opacity-0 blur-xs transition duration-150 ease-out group-data-[live=true]/pointer-status:translate-y-0 group-data-[live=true]/pointer-status:opacity-100 group-data-[live=true]/pointer-status:blur-none motion-reduce:translate-y-0 motion-reduce:blur-none motion-reduce:transition-none"
                  >
                    Tracking
                  </span>
                </span>
              </div>
              <PreviewDeck active={active} />
              <fieldset
                className="absolute bottom-2 left-1/2 m-0 grid w-full max-w-80 -translate-x-1/2 grid-cols-2 gap-2 border-0 p-0"
                aria-label="Preview a view"
              >
                {targets.map((target) => (
                  <DemoTarget
                    key={`${target.name}-${activity}`}
                    controller={controller}
                    {...target}
                    horizon={horizon}
                    margin={margin}
                    stability={stability}
                    cooldown={cooldown}
                    includeCurrent={includeCurrent}
                    once={once}
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
          {(controls || overlay) && (
            <CardFooter>
              <fieldset
                data-demo-controls=""
                className="m-0 grid w-full min-w-0 grid-cols-2 gap-6 border-0 p-0 text-xs"
              >
                <legend className="sr-only">Prediction settings</legend>
                {controls && (
                  <>
                    {sliders.map((slider) => (
                      <div className="min-w-0" key={slider.key}>
                        <div className="flex min-h-9 justify-between gap-2 sm:min-h-5">
                          <span className="min-w-0" id={`${id}-${slider.key}-label`}>
                            {slider.label}
                          </span>
                          <output className="shrink-0 font-mono font-medium whitespace-nowrap text-foreground">
                            {slider.value} {slider.unit}
                          </output>
                        </div>
                        <Slider
                          className="py-3 [&_[data-slot=slider-thumb]]:after:-inset-3.5"
                          aria-labelledby={`${id}-${slider.key}-label`}
                          aria-describedby={`${id}-${slider.key}-description`}
                          aria-valuetext={`${slider.value} ${slider.unit === 'ms' ? 'milliseconds' : 'pixels'}`}
                          min={slider.min}
                          max={slider.max}
                          step={slider.step}
                          value={[slider.value]}
                          onValueChange={(values) => slider.setValue(values[0] ?? slider.value)}
                        />
                        <p
                          className="text-xs leading-relaxed text-muted-foreground"
                          id={`${id}-${slider.key}-description`}
                        >
                          {slider.description}
                        </p>
                      </div>
                    ))}
                    <div className="grid min-w-0 content-start gap-1">
                      <div className="flex min-h-14 items-center justify-between gap-2 sm:min-h-11">
                        <label
                          className="flex min-h-11 cursor-pointer items-center"
                          htmlFor={`${id}-contact`}
                        >
                          Include current contact
                        </label>
                        <Switch
                          className="after:-inset-y-3"
                          id={`${id}-contact`}
                          aria-describedby={`${id}-contact-description`}
                          checked={includeCurrent}
                          onCheckedChange={setIncludeCurrent}
                        />
                      </div>
                      <p
                        className="text-xs leading-relaxed text-muted-foreground"
                        id={`${id}-contact-description`}
                      >
                        Count contact and crossings as a match.
                      </p>
                    </div>
                    <div className="grid min-w-0 content-start gap-1">
                      <div className="flex min-h-14 items-center justify-between gap-2 sm:min-h-11">
                        <label
                          className="flex min-h-11 cursor-pointer items-center"
                          htmlFor={`${id}-once`}
                        >
                          Once per target
                        </label>
                        <Switch
                          className="after:-inset-y-3"
                          id={`${id}-once`}
                          aria-describedby={`${id}-once-description`}
                          checked={once}
                          onCheckedChange={setOnce}
                        />
                      </div>
                      <p
                        className="text-xs leading-relaxed text-muted-foreground"
                        id={`${id}-once-description`}
                      >
                        One callback per target. Reset activity to try again.
                      </p>
                    </div>
                    <div className="grid min-w-0 content-start gap-1">
                      <div className="flex min-h-14 items-center justify-between gap-1 sm:min-h-11 sm:gap-2">
                        <span id={`${id}-reset-label`}>Reset activity</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          aria-label="Reset activity"
                          aria-describedby={`${id}-reset-description`}
                          onClick={resetActivity}
                        >
                          Reset
                        </Button>
                      </div>
                      <p
                        className="text-xs leading-relaxed text-muted-foreground"
                        id={`${id}-reset-description`}
                      >
                        Clear predictions and counts. Keep your settings.
                      </p>
                    </div>
                  </>
                )}
                {overlay && (
                  <div className="flex min-h-14 min-w-0 items-center justify-between gap-2 self-start sm:min-h-11">
                    <label
                      className="flex min-h-11 cursor-pointer items-center"
                      htmlFor={`${id}-overlay`}
                    >
                      Show the library debug overlay
                    </label>
                    <Switch
                      className="after:-inset-y-3"
                      id={`${id}-overlay`}
                      checked={debug}
                      onCheckedChange={setDebug}
                    />
                  </div>
                )}
              </fieldset>
            </CardFooter>
          )}
        </Card>
      </Surface>
      <figcaption className="p-4 text-center text-xs leading-relaxed text-muted-foreground">
        <output className="flex min-h-5 flex-wrap items-center justify-center gap-2">
          {result ? (
            <>
              <span className="size-1.5 rounded-full bg-primary" />
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
