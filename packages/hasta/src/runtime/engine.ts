import { firstSegmentRectIntersection } from '../core/geometry.js';
import { LinearSpatialIndex } from '../core/linear-spatial-index.js';
import type { KalmanPrediction } from '../core/prediction/kalman-predictor.js';
import { KalmanPredictor } from '../core/prediction/kalman-predictor.js';
import type { PointerSample, Prediction, Rect } from '../core/types.js';
import { createDebugOverlay } from './debug/overlay.js';
import type { DebugOptions, DebugSnapshot, DebugRule } from './debug/types.js';
import { measureBounds } from './dom/bounds.js';
import { ObservedPath } from './input/observed-path.js';
import { listenToPointer } from './input/pointer-input.js';
import {
  normalizeHastaOptions,
  normalizeIntersectsCondition,
  debugConfiguration,
} from './options.js';
import { Subscription } from './triggers/subscription.js';
import type { SubscriptionOptions } from './triggers/subscription.js';
import type {
  BoundsSnapshot,
  Hasta,
  HastaOptions,
  IntersectionEvent,
  IntersectsCondition,
  PredictionCondition,
  PredictionContext,
  PredictionEvent,
  TrackedTarget,
} from './types.js';

type IntersectionContext = Omit<IntersectionEvent, 'signal'>;

type Rule = {
  id: number;
  debug: Pick<DebugRule, 'matches' | 'eligible' | 'intersection'> | null;
} & (
  | {
      kind: 'intersection';
      condition: Required<IntersectsCondition>;
      subscription: Subscription<IntersectionContext>;
    }
  | {
      kind: 'predicate';
      condition: PredictionCondition;
      subscription: Subscription<PredictionContext>;
    }
);

interface TargetRecord {
  id: number;
  element: HTMLElement;
  handle: TrackedTarget;
  bounds: BoundsSnapshot | null;
  rules: Set<Rule>;
}

function expand(rect: Rect, margin: number): Rect {
  return {
    minX: rect.minX - margin,
    minY: rect.minY - margin,
    maxX: rect.maxX + margin,
    maxY: rect.maxY + margin,
  };
}

function observedIntersection(
  points: readonly PointerSample[],
  rect: Rect,
): PredictionContext['intersection'] {
  let previous = points[0];

  for (const point of points) {
    if (!previous) {
      break;
    }

    const hit = firstSegmentRectIntersection(previous, point, rect);

    if (hit) {
      return Object.freeze({ etaMs: 0, point: Object.freeze(hit.point) });
    }

    previous = point;
  }

  return null;
}

export function createHasta(input: HastaOptions = {}): Hasta {
  const options = normalizeHastaOptions(input);
  const document = options.document ?? globalThis.document;
  const view = document?.defaultView;

  if (!view || typeof view.requestAnimationFrame !== 'function') {
    throw new Error('createHasta requires a document with an active browser window.');
  }

  const window = view;
  const { horizonMs, maxSampleAgeMs, debug: initialDebug } = options;

  const reportError = (cause: unknown) => {
    try {
      if (options.onError) {
        void Promise.resolve(options.onError(cause)).catch(() => {});
      } else {
        window.console.error(cause);
      }
    } catch {
      /* Error reporting cannot interrupt cleanup or other subscriptions */
    }
  };

  const predictor = new KalmanPredictor({ maxSampleAgeMs });
  const observedPath = new ObservedPath(maxSampleAgeMs);
  const targets = new Map<HTMLElement, TargetRecord>();
  const index = new LinearSpatialIndex<number>();
  const scrollRoots = new Set<ShadowRoot>();
  const removers: (() => void)[] = [];
  let nextId = 0;
  let frame: number | null = null;
  let samples: PointerSample[] = [];
  let evaluatingFrame = false;
  let pendingInput = false;
  let latestSample: PointerSample | null = null;
  let currentRuleCount = 0;
  let destroyed = false;
  let paused = false;
  let generation = 0;
  let nextRuleId = 0;
  let debugOptions: DebugOptions | null = null;
  let debugOverlay: ReturnType<typeof createDebugOverlay> | null = null;
  let debugSnapshot: DebugSnapshot | null = null;
  let debugSamples: PointerSample[] = [];
  let debugPointer: PointerSample | null = null;
  let debugForecast: Prediction | null = null;
  let debugCandidates = new Set<number>();

  function publishDebug(): void {
    if (destroyed || debugOptions === null) {
      return;
    }

    const now = window.performance.now();
    const age = debugPointer === null ? null : Math.max(0, now - debugPointer.timeStamp);
    const fresh = latestSample !== null && now - latestSample.timeStamp < maxSampleAgeMs;
    const pending = fresh && debugForecast !== null && pendingInput;
    const forecast = isRunning() && fresh && !pending ? debugForecast : null;
    const first = forecast?.points[0];
    const last = forecast?.points[1];
    const vx = first && last ? (last.x - first.x) / last.offsetMs : 0;
    const vy = first && last ? (last.y - first.y) / last.offsetMs : 0;
    debugSnapshot = Object.freeze({
      timeStamp: now,
      status: paused
        ? 'paused'
        : document.hidden
          ? 'hidden'
          : fresh
            ? pending
              ? 'pending'
              : forecast
                ? 'tracking'
                : 'warming-up'
            : 'idle',
      samples: Object.freeze([...debugSamples]),
      pointer: debugPointer,
      forecast,
      velocity: forecast ? Object.freeze({ x: vx, y: vy, speed: Math.hypot(vx, vy) }) : null,
      sampleAgeMs: age,
      horizonMs: last?.offsetMs ?? horizonMs,
      maxSampleAgeMs,
      targets: Object.freeze(
        [...targets.values()].map((target) =>
          Object.freeze({
            id: target.id,
            label: (
              (target.element.dataset.hastaLabel ?? '') ||
              target.element.id ||
              `${target.element.tagName.toLowerCase()} ${target.id}`
            ).slice(0, 80),
            rect: target.bounds?.rect ?? null,
            measuredAt: target.bounds?.measuredAt ?? null,
            candidate: forecast !== null && debugCandidates.has(target.id),
            rules: Object.freeze(
              [...target.rules].map((rule) =>
                Object.freeze({
                  id: rule.id,
                  kind:
                    rule.kind === 'intersection' ? ('intersects' as const) : ('predicate' as const),
                  withinMs: rule.kind === 'intersection' ? rule.condition.withinMs : horizonMs,
                  marginPx: rule.kind === 'intersection' ? rule.condition.marginPx : 0,
                  includeCurrent: rule.kind === 'intersection' && rule.condition.includeCurrent,
                  matches: forecast !== null && (rule.debug?.matches ?? false),
                  eligible: forecast !== null && (rule.debug?.eligible ?? false),
                  intersection: forecast ? (rule.debug?.intersection ?? null) : null,
                  ...rule.subscription.getDebugState(),
                }),
              ),
            ),
          }),
        ),
      ),
    });
    debugOverlay?.render(debugSnapshot);
  }

  function setDebug(value: boolean | DebugOptions): void {
    if (destroyed) {
      throw new Error('Cannot enable debugging after destroy().');
    }

    const next = debugConfiguration(value);

    if (next === false) {
      debugOverlay?.destroy();
      debugOverlay = null;
      debugOptions = null;
      debugSnapshot = null;
      debugSamples = [];
      debugPointer = null;
      debugForecast = null;
      debugCandidates.clear();

      for (const target of targets.values()) {
        for (const rule of target.rules) {
          rule.debug = null;
        }
      }

      return;
    }

    debugOptions = next;

    if (debugOverlay) {
      debugOverlay.setOptions(debugOptions);
    } else {
      debugOverlay = createDebugOverlay(document, debugOptions);
    }

    publishDebug();
    requestFrame();
  }

  const isRunning = () => !destroyed && !paused && !document.hidden;

  const requestFrame = () => {
    if (isRunning() && targets.size > 0 && frame === null) {
      frame = window.requestAnimationFrame(tick);
    }
  };

  const invalidateRules = () => {
    const epoch = generation;

    for (const target of [...targets.values()]) {
      for (const rule of [...target.rules]) {
        if (epoch !== generation) {
          return;
        }

        rule.subscription.invalidate();
      }
    }
  };

  const resetInput = () => {
    generation++;
    predictor.reset();
    samples = [];
    pendingInput = false;
    observedPath.clear();
    latestSample = null;

    if (debugOptions !== null) {
      debugForecast = null;
      debugCandidates.clear();
      debugSamples = [];

      for (const target of targets.values()) {
        for (const rule of target.rules) {
          rule.debug = null;
        }
      }
    }

    if (frame !== null) {
      window.cancelAnimationFrame(frame);
    }

    frame = null;
    invalidateRules();
    publishDebug();
  };

  const resizeObserver =
    typeof window.ResizeObserver === 'function' ? new window.ResizeObserver(requestFrame) : null;

  const listen = (target: EventTarget, type: string, listener: EventListener) => {
    target.addEventListener(type, listener, { capture: true, passive: true });
    removers.push(() => target.removeEventListener(type, listener, true));
  };

  listen(document, 'scroll', requestFrame);
  listen(window, 'resize', requestFrame);

  if (window.visualViewport) {
    listen(window.visualViewport, 'scroll', requestFrame);
    listen(window.visualViewport, 'resize', requestFrame);
  }

  removers.push(
    listenToPointer(
      document,
      (sample) => {
        if (!isRunning() || targets.size === 0) {
          return false;
        }

        if (latestSample !== null && sample.timeStamp - latestSample.timeStamp >= maxSampleAgeMs) {
          const epoch = generation;
          resetInput();

          if (generation !== epoch + 1 || latestSample !== null) {
            return false;
          }
        }

        if (!isRunning()) {
          return false;
        }

        if (currentRuleCount > 0) {
          observedPath.push(sample);
        }

        latestSample = sample;
        pendingInput = true;

        if (evaluatingFrame) {
          const last = samples.at(-1);

          if (last?.timeStamp === sample.timeStamp) {
            samples[samples.length - 1] = sample;
          } else {
            samples.push(sample);
          }
        } else {
          predictor.update(sample);
        }

        if (debugOptions !== null) {
          const point = Object.freeze({ ...sample });
          debugPointer = point;

          if (debugSamples.at(-1)?.timeStamp === point.timeStamp) {
            debugSamples[debugSamples.length - 1] = point;
          } else {
            debugSamples.push(point);
          }

          if (debugSamples.length > 32) {
            debugSamples.shift();
          }
        }

        requestFrame();

        return true;
      },
      resetInput,
      requestFrame,
      (sample) => {
        const now = window.performance.now();

        return (
          isRunning() &&
          targets.size > 0 &&
          sample.timeStamp <= now &&
          now - sample.timeStamp < maxSampleAgeMs &&
          (latestSample === null || sample.timeStamp >= latestSample.timeStamp)
        );
      },
    ),
  );

  function refreshBounds(now: number, epoch: number): boolean {
    const roots = new Set<ShadowRoot>();

    for (const target of [...targets.values()]) {
      if (!isRunning() || epoch !== generation) {
        return false;
      }

      if (targets.get(target.element) !== target) {
        continue;
      }

      const previous = target.bounds?.rect;
      let bounds: BoundsSnapshot | null = null;

      try {
        bounds = measureBounds(target.element, document, now);
      } catch (error) {
        if (epoch === generation) {
          target.bounds = null;
          index.delete(target.id);
        }

        reportError(error);
      }

      if (!isRunning() || epoch !== generation) {
        return false;
      }

      if (targets.get(target.element) !== target) {
        continue;
      }

      target.bounds = bounds;

      if (bounds) {
        const rect = bounds.rect;

        if (
          !previous ||
          previous.minX !== rect.minX ||
          previous.minY !== rect.minY ||
          previous.maxX !== rect.maxX ||
          previous.maxY !== rect.maxY
        ) {
          index.set(target.id, rect);
        }
      } else {
        index.delete(target.id);
      }

      let node: Node = target.element;

      while (true) {
        const root = node.getRootNode();

        if (!(root instanceof window.ShadowRoot)) {
          break;
        }

        roots.add(root);
        node = root.host;
      }
    }

    for (const root of scrollRoots) {
      if (!roots.has(root)) {
        root.removeEventListener('scroll', requestFrame, true);
        scrollRoots.delete(root);
      }
    }

    for (const root of roots) {
      if (!scrollRoots.has(root)) {
        root.addEventListener('scroll', requestFrame, { capture: true, passive: true });
        scrollRoots.add(root);
      }
    }

    return true;
  }

  function flushSamples(): void {
    const pending = samples;
    samples = [];

    for (const sample of pending) {
      predictor.update(sample);
    }
  }

  function tick(): void {
    evaluatingFrame = true;

    try {
      evaluateFrame();
    } finally {
      evaluatingFrame = false;
      flushSamples();
    }
  }

  function evaluateFrame(): void {
    frame = null;

    if (!isRunning() || targets.size === 0) {
      return;
    }

    const measuredAt = window.performance.now();
    const epoch = generation;

    if (!refreshBounds(measuredAt, epoch)) {
      return;
    }

    const now = window.performance.now();
    flushSamples();
    pendingInput = false;

    const pointer = latestSample;
    const observed = observedPath.take(now);

    if (pointer === null || now - pointer.timeStamp >= maxSampleAgeMs) {
      resetInput();

      return;
    }

    let maxHorizon = horizonMs;
    let maxMargin = 0;

    for (const target of targets.values()) {
      for (const rule of target.rules) {
        if (rule.kind === 'intersection') {
          maxHorizon = Math.max(maxHorizon, rule.condition.withinMs);
          maxMargin = Math.max(maxMargin, rule.condition.marginPx);
        }
      }
    }

    const forecasts = new Map<number, KalmanPrediction | null>();
    let prediction = predictor.predict(now, maxHorizon);
    forecasts.set(maxHorizon, prediction);

    // One overflowing rule must not silence independent, representable forecasts
    if (!prediction) {
      const horizons = new Set([horizonMs]);

      for (const target of targets.values()) {
        for (const rule of target.rules) {
          if (rule.kind === 'intersection') {
            horizons.add(rule.condition.withinMs);
          }
        }
      }

      // oxlint-disable-next-line unicorn/no-array-sort -- Sort a private scratch copy without requiring ES2023
      for (const horizon of [...horizons].sort((a, b) => b - a)) {
        if (horizon === maxHorizon) {
          continue;
        }

        prediction = predictor.predict(now, horizon);
        forecasts.set(horizon, prediction);

        if (prediction) {
          break;
        }
      }
    }

    if (debugOptions !== null) {
      debugForecast = prediction;

      for (const target of targets.values()) {
        for (const rule of target.rules) {
          rule.debug = null;
        }
      }
    }

    if (!prediction) {
      invalidateRules();
      publishDebug();
      requestFrame();

      return;
    }

    const start = prediction.points[0];
    const end = prediction.points[1];

    const pathBounds = {
      minX: Math.min(pointer.x, start.x, end.x),
      minY: Math.min(pointer.y, start.y, end.y),
      maxX: Math.max(pointer.x, start.x, end.x),
      maxY: Math.max(pointer.y, start.y, end.y),
    };

    for (const point of observed) {
      pathBounds.minX = Math.min(pathBounds.minX, point.x);
      pathBounds.minY = Math.min(pathBounds.minY, point.y);
      pathBounds.maxX = Math.max(pathBounds.maxX, point.x);
      pathBounds.maxY = Math.max(pathBounds.maxY, point.y);
    }

    const query = expand(pathBounds, maxMargin);

    // Candidate padding accounts for rounding without changing the target margin
    const rounding =
      Math.max(
        1,
        Math.abs(query.minX),
        Math.abs(query.minY),
        Math.abs(query.maxX),
        Math.abs(query.maxY),
      ) *
      (4 * Number.EPSILON);

    const conservativeQuery = expand(query, rounding);

    // Overflowing a conservative query must never discard a real candidate
    const candidates = Object.values(conservativeQuery).every((value) => Number.isFinite(value))
      ? new Set(index.query(conservativeQuery))
      : new Set([...targets.values()].map((target) => target.id));

    if (debugOptions !== null) {
      debugCandidates = new Set(candidates);
    }

    const queue: (() => void)[] = [];

    for (const target of [...targets.values()]) {
      let intersections: Map<number, Map<number, PredictionContext['intersection']>> | null = null;
      let contacts: Map<number, PredictionContext['intersection']> | null = null;

      for (const rule of [...target.rules]) {
        if (!isRunning() || epoch !== generation) {
          return;
        }

        if (targets.get(target.element) !== target || !target.rules.has(rule)) {
          continue;
        }

        if (!target.bounds) {
          rule.subscription.invalidate();
          continue;
        }

        if (rule.kind === 'intersection' && !candidates.has(target.id)) {
          rule.subscription.invalidate();
          continue;
        }

        const horizon = rule.kind === 'intersection' ? rule.condition.withinMs : horizonMs;
        let forecast = forecasts.get(horizon);

        if (forecast === undefined) {
          forecast = predictor.predict(now, horizon);
          forecasts.set(horizon, forecast);
        }

        if (!forecast) {
          rule.subscription.invalidate();
          continue;
        }

        try {
          const rect = target.bounds.rect;
          const margin = rule.kind === 'intersection' ? rule.condition.marginPx : 0;
          intersections ??= new Map();
          let byHorizon = intersections.get(margin);

          if (!byHorizon) {
            byHorizon = new Map<number, PredictionContext['intersection']>();
            intersections.set(margin, byHorizon);
          }

          let intersection = byHorizon.get(horizon);

          if (intersection === undefined) {
            const hit = candidates.has(target.id)
              ? predictor.intersectRect(now, horizon, margin === 0 ? rect : expand(rect, margin))
              : null;

            intersection =
              hit === null
                ? null
                : Object.freeze({
                    etaMs: hit.offsetMs,
                    point: Object.freeze(hit.point),
                  });
            byHorizon.set(horizon, intersection);
          }

          if (rule.kind === 'intersection' && rule.condition.includeCurrent) {
            contacts ??= new Map();
            let contact = contacts.get(margin);

            if (contact === undefined) {
              contact = observedIntersection(observed, margin === 0 ? rect : expand(rect, margin));
              contacts.set(margin, contact);
            }

            intersection = contact ?? intersection;
          }

          if (rule.kind === 'intersection' && intersection === null && rule.subscription.latched) {
            const age = now - pointer.timeStamp;

            const crossing =
              age > 0
                ? predictor.intersectRect(
                    pointer.timeStamp,
                    age,
                    margin === 0 ? rect : expand(rect, margin),
                  )
                : null;

            if (crossing) {
              intersection = Object.freeze({ etaMs: 0, point: Object.freeze(crossing.point) });
            }
          }

          // Observed contact takes precedence over extrapolated departure
          if (
            rule.kind === 'intersection' &&
            (rule.condition.includeCurrent || rule.subscription.latched) &&
            pointer.x >= rect.minX - margin &&
            pointer.x <= rect.maxX + margin &&
            pointer.y >= rect.minY - margin &&
            pointer.y <= rect.maxY + margin
          ) {
            intersection = Object.freeze({
              etaMs: 0,
              point: Object.freeze({ x: pointer.x, y: pointer.y }),
            });
          }

          if (rule.kind === 'intersection' && intersection === null) {
            rule.subscription.invalidate();
            continue;
          }

          const context: PredictionContext = Object.freeze({
            element: target.element,
            ...target.bounds,
            evaluatedAt: now,
            forecast,
            intersection,
          });

          let callback: (() => void) | null;

          if (rule.kind === 'intersection') {
            const event: IntersectionContext | null =
              intersection &&
              Object.freeze({
                ...context,
                intersection,
                etaMs: intersection.etaMs,
                predictedAt: now + intersection.etaMs,
              });

            const eligible =
              rule.condition.includeCurrent ||
              intersection?.etaMs !== 0 ||
              rule.subscription.latched;

            if (debugOptions !== null) {
              rule.debug = {
                matches: intersection !== null,
                eligible: intersection !== null && eligible,
                intersection,
              };
            }

            callback = rule.subscription.evaluate(intersection !== null, now, event, eligible);
          } else {
            const matches: unknown = rule.condition(context);

            if (typeof matches !== 'boolean') {
              void Promise.resolve(matches).catch(() => {});
              throw new TypeError('A condition must return a boolean synchronously.');
            }

            if (!isRunning() || epoch !== generation) {
              return;
            }

            if (targets.get(target.element) !== target || !target.rules.has(rule)) {
              continue;
            }

            if (debugOptions !== null) {
              rule.debug = { matches, eligible: matches, intersection };
            }

            callback = rule.subscription.evaluate(matches, now, context);
          }

          if (callback) {
            queue.push(callback);
          }
        } catch (error) {
          if (epoch === generation) {
            rule.subscription.invalidate();
          }

          reportError(error);
        }

        if (!isRunning() || epoch !== generation) {
          return;
        }
      }
    }

    for (const callback of queue) {
      if (!isRunning() || epoch !== generation) {
        break;
      }

      callback();
    }

    publishDebug();
    requestFrame();
  }

  function removeRule(target: TargetRecord, rule: Rule): void {
    if (!target.rules.delete(rule)) {
      return;
    }

    if (rule.kind === 'intersection' && rule.condition.includeCurrent) {
      currentRuleCount--;

      if (currentRuleCount === 0) {
        observedPath.clear();
      }
    }

    rule.subscription.dispose();
  }

  function track(element: HTMLElement): TrackedTarget {
    if (destroyed) {
      throw new Error('Cannot track elements after destroy().');
    }

    if (!(element instanceof window.HTMLElement) || element.ownerDocument !== document) {
      throw new TypeError('track() requires an HTMLElement from this instance’s document.');
    }

    const existing = targets.get(element);

    if (existing) {
      return existing.handle;
    }

    const active = () => targets.get(element) === record;
    function when(
      condition: IntersectsCondition,
      callback: (event: IntersectionEvent) => void | Promise<void>,
      options?: SubscriptionOptions,
    ): () => void;
    function when(
      condition: PredictionCondition,
      callback: (event: PredictionEvent) => void | Promise<void>,
      options?: SubscriptionOptions,
    ): () => void;
    function when(
      condition: IntersectsCondition | PredictionCondition,
      callback:
        | ((event: IntersectionEvent) => void | Promise<void>)
        | ((event: PredictionEvent) => void | Promise<void>),
      subscriptionOptions: SubscriptionOptions = {},
    ): () => void {
      if (!active() || destroyed) {
        throw new Error('Cannot subscribe to an untracked target.');
      }

      let rule: Rule;

      if (typeof condition === 'function') {
        rule = {
          id: nextRuleId++,
          debug: null,
          kind: 'predicate',
          condition,
          subscription: new Subscription<PredictionContext>(
            // SAFETY: The predicate overload requires a callback accepting PredictionEvent
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- The public overload binds the callback to the condition
            callback as (event: PredictionEvent) => void | Promise<void>,
            subscriptionOptions,
            reportError,
            publishDebug,
          ),
        };
      } else {
        rule = {
          id: nextRuleId++,
          debug: null,
          kind: 'intersection',
          condition: normalizeIntersectsCondition(condition),
          subscription: new Subscription<IntersectionContext>(
            callback,
            subscriptionOptions,
            reportError,
            publishDebug,
          ),
        };
      }

      record.rules.add(rule);

      if (rule.kind === 'intersection' && rule.condition.includeCurrent) {
        if (currentRuleCount === 0 && latestSample !== null) {
          observedPath.push(latestSample);
        }

        currentRuleCount++;
      }

      requestFrame();

      return () => {
        removeRule(record, rule);
        publishDebug();
      };
    }

    const handle: TrackedTarget = Object.freeze({
      getBounds: () =>
        active() && element.isConnected && element.ownerDocument === document
          ? record.bounds
          : null,
      invalidate: () => {
        if (active()) {
          requestFrame();
        }
      },
      when,
      untrack: () => {
        if (!active()) {
          return;
        }

        targets.delete(element);
        index.delete(record.id);
        resizeObserver?.unobserve(element);
        record.bounds = null;

        for (const rule of [...record.rules]) {
          removeRule(record, rule);
        }

        record.rules.clear();

        if (targets.size === 0) {
          resetInput();

          for (const root of scrollRoots) {
            root.removeEventListener('scroll', requestFrame, true);
          }

          scrollRoots.clear();
        } else {
          requestFrame();
        }

        publishDebug();
      },
    });

    const record: TargetRecord = { id: nextId++, element, handle, bounds: null, rules: new Set() };
    targets.set(element, record);
    resizeObserver?.observe(element);
    requestFrame();

    return record.handle;
  }

  setDebug(initialDebug);

  return Object.freeze({
    track,
    setDebug,
    getDebugSnapshot: () => debugSnapshot,
    pause() {
      if (destroyed || paused) {
        return;
      }

      paused = true;
      resetInput();
    },
    resume() {
      if (destroyed || !paused) {
        return;
      }

      paused = false;
      resetInput();
      requestFrame();
    },
    destroy() {
      if (destroyed) {
        return;
      }

      destroyed = true;
      debugOverlay?.destroy();
      debugOverlay = null;
      debugSnapshot = null;
      debugSamples = [];
      debugPointer = null;
      debugForecast = null;
      debugCandidates.clear();
      resetInput();

      for (const remove of removers) {
        remove();
      }

      resizeObserver?.disconnect();

      for (const root of scrollRoots) {
        root.removeEventListener('scroll', requestFrame, true);
      }

      scrollRoots.clear();

      for (const target of [...targets.values()]) {
        target.handle.untrack();
      }

      index.clear();
    },
  });
}
