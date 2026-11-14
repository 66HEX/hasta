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
          <CardFooter>
            <div className="flex w-full flex-col gap-4">
              {controls && (
                <fieldset className="prediction-controls">
                  <legend className="sr-only">Prediction settings</legend>
                  <div className="prediction-sliders">
                    {sliders.map((slider) => (
                      <div className="prediction-control" key={slider.key}>
                        <div className="flex justify-between gap-2">
                          <span className="min-w-0" id={`${id}-${slider.key}-label`}>
                            {slider.label}
                          </span>
                          <output className="shrink-0 font-mono font-medium whitespace-nowrap text-foreground">
                            {slider.value} {slider.unit}
                          </output>
                        </div>
                        <Slider
                          aria-labelledby={`${id}-${slider.key}-label`}
                          aria-describedby={`${id}-${slider.key}-description`}
                          aria-valuetext={`${slider.value} ${slider.unit === 'ms' ? 'milliseconds' : 'pixels'}`}
                          min={slider.min}
                          max={slider.max}
                          step={slider.step}
                          value={[slider.value]}
                          onValueChange={(values) => slider.setValue(values[0] ?? slider.value)}
                        />
                        <p id={`${id}-${slider.key}-description`}>{slider.description}</p>
                      </div>
                    ))}
                  </div>
                  <div className="prediction-switches">
                    <div className="prediction-switch">
                      <label htmlFor={`${id}-contact`}>Include current contact</label>
                      <Switch
                        id={`${id}-contact`}
                        aria-describedby={`${id}-contact-description`}
                        checked={includeCurrent}
                        onCheckedChange={setIncludeCurrent}
                      />
                      <p id={`${id}-contact-description`}>
                        Count contact and crossings as a match.
                      </p>
                    </div>
                    <div className="prediction-switch">
                      <label htmlFor={`${id}-once`}>Once per target</label>
                      <Switch
                        id={`${id}-once`}
                        aria-describedby={`${id}-once-description`}
                        checked={once}
                        onCheckedChange={setOnce}
                      />
                      <p id={`${id}-once-description`}>
                        One callback per target. Reset activity to try again.
                      </p>
                    </div>
                  </div>
                  <div className="prediction-reset">
                    <p>Clear predictions and counts. Keep your settings.</p>
                    <Button type="button" variant="outline" onClick={resetActivity}>
                      Reset activity
                    </Button>
                  </div>
                </fieldset>
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
