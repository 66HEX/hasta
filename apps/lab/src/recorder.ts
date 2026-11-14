import { firstSegmentRectIntersection } from '@66hex/hasta/core';
import type { Point, Rect } from '@66hex/hasta/core';
import { createHasta } from '@66hex/hasta/vanilla';
import type { Hasta } from '@66hex/hasta/vanilla';

import { assessTrial } from './quality';
import type { Outcome, Plan, Session, Target, Trial } from './types';

export function rectOf(element: Element): Rect {
  const rect = element.getBoundingClientRect();

  return { minX: rect.left, minY: rect.top, maxX: rect.right, maxY: rect.bottom };
}

export function recordTrial(
  board: HTMLElement,
  plan: Plan,
  baseline: Session['baseline'],
  onComplete: (trial: Trial) => void,
  onGatePassed: () => void,
  start: Point,
  attempt: number,
  onStart: (trial: Trial) => void,
) {
  const startTime = performance.now();
  const elements = [...board.querySelectorAll<HTMLButtonElement>('[data-target]')];
  const gate = board.querySelector('[data-gate]');
  const startElement = board.querySelector('[data-start]');
  const finishElement = board.querySelector('.finish-zone');

  if (!startElement) {
    throw new Error('The start area is missing.');
  }

  const targets: Target[] = elements.map((element) => ({
    id: element.dataset.target ?? '',
    label: element.textContent ?? '',
    rect: rectOf(element),
  }));

  const trial: Trial = {
    id: crypto.randomUUID(),
    plan,
    startedAt: new Date().toISOString(),
    timeOrigin: performance.timeOrigin,
    startTime,
    duration: 0,
    board: rectOf(board),
    targets,
    gate: gate ? rectOf(gate) : null,
    gatePassedAt: null,
    samples: [],
    frames: [],
    ticks: [],
    callbacks: [],
    events: [],
    outcome: 'interrupted',
    selected: null,
    reason: null,
    context: {
      attempt,
      start,
      startRect: rectOf(startElement),
      finishRect: finishElement ? rectOf(finishElement) : null,
      end: null,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollX, scrollY },
    },
  };

  onStart(trial);

  let stopped = false;
  let frameId = 0;
  let timeoutId = 0;
  let batch = 0;
  let hasta: Hasta | null = null;
  let previous: (Point & { timeStamp: number }) | null = null;
  const removers: (() => void)[] = [];
  const now = () => performance.now() - startTime;

  function finish(outcome: Outcome, selected: string | null = null, reason: string | null = null) {
    if (stopped || (outcome === 'none' && trial.gatePassedAt === null)) {
      return;
    }

    stopped = true;
    trial.duration = now();
    trial.outcome = outcome;
    trial.selected = selected;
    trial.reason = reason;
    trial.quality = assessTrial(trial);
    cancelAnimationFrame(frameId);
    clearTimeout(timeoutId);

    for (const remove of removers) {
      remove();
    }

    hasta?.destroy();
    onComplete(trial);
  }

  const move = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || stopped) {
      return;
    }

    const arrivedAt = now();
    const coalesced = event.getCoalescedEvents?.() ?? [];
    const samples = coalesced.length > 0 ? coalesced : [event];
    batch++;

    for (const sample of samples) {
      if (
        ![sample.clientX, sample.clientY, sample.timeStamp].every((value) => Number.isFinite(value))
      ) {
        continue;
      }

      trial.samples.push({
        x: sample.clientX,
        y: sample.clientY,
        timeStamp: sample.timeStamp - startTime,
        arrivedAt,
        batch,
        buttons: event.buttons,
      });
      const point = { x: sample.clientX, y: sample.clientY, timeStamp: sample.timeStamp };
      const from = previous && point.timeStamp - previous.timeStamp <= 100 ? previous : point;

      if (
        trial.gate &&
        trial.gatePassedAt === null &&
        event.buttons === 0 &&
        firstSegmentRectIntersection(from, point, trial.gate) !== null
      ) {
        trial.gatePassedAt = arrivedAt;
        onGatePassed();
      }

      previous = event.buttons === 0 ? point : null;
    }

    if (trial.samples.length > 100_000) {
      finish('interrupted', null, 'The sample limit was reached.');
    }
  };

  document.addEventListener('pointermove', move, { capture: true, passive: true });
  removers.push(() => document.removeEventListener('pointermove', move, true));

  const reset = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') {
      previous = null;
      trial.events.push({ type: 'reset', target: null, at: now() });
      const last = trial.events.at(-1);

      if (last) {
        last.cause = event.type;
      }

      if (trial.context && event.type === 'pointerup') {
        trial.context.end = {
          x: event.clientX,
          y: event.clientY,
          at: now(),
          timeStamp: event.timeStamp - startTime,
        };
      }
    }
  };

  for (const name of ['pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    document.addEventListener(name, reset, { capture: true, passive: true });
    removers.push(() => document.removeEventListener(name, reset, true));
  }

  const leaveWindow = (event: PointerEvent) => {
    if (event.relatedTarget === null) {
      reset(event);
      finish('interrupted', null, 'The pointer left the window.');
    }
  };

  document.addEventListener('pointerout', leaveWindow, { capture: true, passive: true });
  removers.push(() => document.removeEventListener('pointerout', leaveWindow, true));

  for (const element of elements) {
    const target = element.dataset.target ?? '';

    const enter = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        trial.events.push({ type: 'enter', target, at: now() });
      }
    };

    const leave = (event: PointerEvent) => {
      if (event.pointerType === 'mouse') {
        trial.events.push({ type: 'leave', target, at: now() });
      }
    };

    element.addEventListener('pointerenter', enter);
    element.addEventListener('pointerleave', leave);
    removers.push(() => {
      element.removeEventListener('pointerenter', enter);
      element.removeEventListener('pointerleave', leave);
    });
  }

  const interrupt = () =>
    finish('interrupted', null, 'The window, scroll position, or page visibility changed.');

  const visibility = () => {
    if (document.hidden) {
      interrupt();
    }
  };

  window.addEventListener('blur', interrupt);

  const resize = new ResizeObserver(() => {
    const current = rectOf(board);

    if (
      (['minX', 'minY', 'maxX', 'maxY'] as const).some((key) => current[key] !== trial.board[key])
    ) {
      interrupt();
    }
  });

  resize.observe(board);
  window.addEventListener('resize', interrupt);
  window.addEventListener('scroll', interrupt, true);
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('pointerlockchange', interrupt);
  removers.push(() => {
    resize.disconnect();
    window.removeEventListener('blur', interrupt);
    window.removeEventListener('resize', interrupt);
    window.removeEventListener('scroll', interrupt, true);
    document.removeEventListener('visibilitychange', visibility);
    document.removeEventListener('pointerlockchange', interrupt);
  });

  hasta = createHasta({
    horizonMs: baseline.horizonMs,
    maxSampleAgeMs: baseline.maxSampleAgeMs,
    onError: () => finish('interrupted', null, 'The predictor reported an error.'),
  });

  for (const element of elements) {
    const target = element.dataset.target ?? '';
    const tracked = hasta.track(element);
    tracked.when(
      { type: 'intersects', withinMs: baseline.horizonMs, includeCurrent: false, marginPx: 0 },
      (event) => {
        trial.callbacks.push({
          target,
          at: now(),
          evaluatedAt: event.evaluatedAt - startTime,
          etaMs: event.etaMs,
        });
      },
      { once: baseline.once, stableForMs: baseline.stableForMs },
    );
    tracked.when(
      (context) => {
        const original = targets.find((item) => item.id === target);

        if (
          original &&
          (['minX', 'minY', 'maxX', 'maxY'] as const).some(
            (bound) => Math.abs(original.rect[bound] - context.rect[bound]) > 0.5,
          )
        ) {
          finish('interrupted', null, 'The target layout changed during the trial.');

          return false;
        }

        const at = context.evaluatedAt - startTime;
        let frame = trial.frames.at(-1);

        if (!frame || frame.at !== at) {
          frame = {
            at,
            measuredAt: context.measuredAt - startTime,
            forecast: context.forecast.points.map((point) => ({ ...point })),
            hits: [],
          };
          trial.frames.push(frame);
        }

        if (context.intersection) {
          frame.hits.push({ target, etaMs: context.intersection.etaMs });
        }

        return false;
      },
      () => {},
    );
  }

  const tick = () => {
    if (stopped) {
      return;
    }

    if (trial.context && devicePixelRatio !== trial.context.viewport.dpr) {
      interrupt();

      return;
    }

    trial.ticks.push(now());
    frameId = requestAnimationFrame(tick);
  };

  frameId = requestAnimationFrame(tick);
  timeoutId = window.setTimeout(
    () => finish('timeout', null, 'The trial reached its 5-second time limit.'),
    5000,
  );

  return { finish };
}
