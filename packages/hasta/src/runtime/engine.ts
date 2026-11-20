import { firstSegmentRectIntersection } from '../core/geometry.js';
import type { KalmanPrediction } from '../core/prediction/kalman-predictor.js';
import { KalmanPredictor } from '../core/prediction/kalman-predictor.js';
import type { PointerSample, Prediction, Rect } from '../core/types.js';
import { createDebugOverlay } from './debug/overlay.js';
import type { DebugOptions, DebugSnapshot, DebugRule } from './debug/types.js';
import { measureBounds, snapshotBounds } from './dom/bounds.js';
import type { MeasuredBounds } from './dom/bounds.js';
import { GeometryCache, GEOMETRY_EVENTS } from './dom/geometry-cache.js';
import { GridIndex } from './dom/grid-index.js';
import { ObservedPath } from './input/observed-path.js';
import { listenToPointer } from './input/pointer-input.js';
import {
  normalizeHastaOptions,
  normalizeIntersectsCondition,
  debugConfiguration,
} from './options.js';
import { IntersectionHysteresis, RELEASE_MARGIN_PX } from './triggers/intersection-hysteresis.js';
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
  active: boolean;
  scannable: boolean;
  missVersion: number;
  debug: Pick<DebugRule, 'matches' | 'eligible' | 'intersection'> | null;
} & (
  | {
      kind: 'intersection';
      hysteresis: IntersectionHysteresis;
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
  bounds: MeasuredBounds | null;
  snapshot: BoundsSnapshot | null;
  rules: Set<Rule>;
  ruleList: readonly Rule[] | null;
  tracked: boolean;
  activeRules: number;
  scannableRules: number;
  predicates: number;
  missVersion: number;
  missEvidence: number | null;
}

function snapshotRules(target: TargetRecord): readonly Rule[] {
  return (target.ruleList ??= [...target.rules]);
}

function getBoundsSnapshot(target: TargetRecord): BoundsSnapshot | null {
  if (target.bounds === null) {
    return null;
  }

  target.snapshot ??= snapshotBounds(target.bounds);

  return target.snapshot;
}

function finiteBound(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function expand(rect: Rect, margin: number): Rect {
  return {
    minX: finiteBound(rect.minX - margin, -Number.MAX_VALUE),
    minY: finiteBound(rect.minY - margin, -Number.MAX_VALUE),
    maxX: finiteBound(rect.maxX + margin, Number.MAX_VALUE),
    maxY: finiteBound(rect.maxY + margin, Number.MAX_VALUE),
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
  let targetList: readonly TargetRecord[] | null = null;
  const snapshotTargets = () => (targetList ??= [...targets.values()]);
  let selectionVersion = 0;
  let scannableRuleCount = 0;
  let activeRuleCount = 0;
  let predicateRuleCount = 0;
  let missVersion = 0;
  let allMissVersion = 0;
  let allMissEvidence: number | null = null;
  const scrollRoots = new Set<ShadowRoot>();
  const removers: (() => void)[] = [];
  let nextId = 0;
  let frame: number | null = null;
  let samples: PointerSample[] = [];
  let evaluatingFrame = false;
  let frameHidden = document.hidden;
  let pendingInput = false;
  let latestSample: PointerSample | null = null;
  let currentRuleCount = 0;
  let destroyed = false;
  let paused = false;
  let generation = 0;
  let ruleExtentsDirty = true;
  let maxHorizon = horizonMs;
  let maxMargin = 0;
  let nextRuleId = 0;
  let debugOptions: DebugOptions | null = null;
  let debugOverlay: ReturnType<typeof createDebugOverlay> | null = null;
  let debugSnapshot: DebugSnapshot | null = null;
  let debugSamples: PointerSample[] = [];
  let debugPointer: PointerSample | null = null;
  let debugForecast: Prediction | null = null;
  let debugCandidates = new Set<number>();

  // A shared miss is consumed lazily, in order with target-local misses
  function applyMiss(target: TargetRecord, rule: Rule): void {
    const shared = allMissVersion > target.missVersion;
    const version = shared ? allMissVersion : target.missVersion;
    const evidence = shared ? allMissEvidence : target.missEvidence;

    if (version > rule.missVersion && evidence !== null) {
      rule.subscription.recordMiss(evidence);
      rule.missVersion = version;
    }
  }

  function recordMiss(target: TargetRecord | undefined, evidenceTime: number): void {
    if (target?.tracked === true) {
      target.missEvidence = evidenceTime;
      target.missVersion = ++missVersion;
    }
  }

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
        snapshotTargets().map((target) =>
          Object.freeze({
            id: target.id,
            label: (
              (target.element.dataset.hastaLabel ?? '') ||
              target.element.id ||
              `${target.element.tagName.toLowerCase()} ${target.id}`
            ).slice(0, 80),
            rect: getBoundsSnapshot(target)?.rect ?? null,
            measuredAt: target.bounds?.measuredAt ?? null,
            candidate: forecast !== null && debugCandidates.has(target.id),
            rules: Object.freeze(
              snapshotRules(target).map((rule) =>
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

  const isRunning = () =>
    !destroyed && !paused && !(evaluatingFrame ? frameHidden : document.hidden);

  const requestFrame = () => {
    if (isRunning() && targets.size > 0 && frame === null) {
      frame = window.requestAnimationFrame(tick);
    }
  };

  const geometryCache =
    options.bounds === 'cached' ? new GeometryCache(document, requestFrame) : null;

  const spatial = geometryCache === null ? null : new GridIndex();

  const invalidateGeometry = () => {
    geometryCache?.invalidate();
    requestFrame();
  };

  const invalidateRules = (observation?: { evaluatedAt: number; timeStamp: number }) => {
    const epoch = generation;

    for (const target of snapshotTargets()) {
      for (const rule of snapshotRules(target)) {
        if (epoch !== generation) {
          return;
        }

        applyMiss(target, rule);

        if (observation === undefined) {
          rule.subscription.invalidate();
        } else {
          rule.subscription.evaluate(
            false,
            observation.evaluatedAt,
            null,
            true,
            observation.timeStamp,
          );
        }
      }
    }
  };

  const resetInput = () => {
    generation++;
    geometryCache?.markDirty();
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
    typeof window.ResizeObserver === 'function'
      ? new window.ResizeObserver(invalidateGeometry)
      : null;

  const listen = (target: EventTarget, type: string, listener: EventListener) => {
    target.addEventListener(type, listener, { capture: true, passive: true });
    removers.push(() => target.removeEventListener(type, listener, true));
  };

  const listenOptional = (
    target: EventTarget | null | undefined,
    type: string,
    listener: EventListener,
  ) => {
    if (target !== undefined && target !== null) {
      listen(target, type, listener);
    }
  };

  listen(document, 'visibilitychange', () => {
    frameHidden = document.hidden;
  });
  listen(document, 'scroll', invalidateGeometry);
  listen(window, 'resize', invalidateGeometry);

  if (window.visualViewport) {
    listen(window.visualViewport, 'scroll', invalidateGeometry);
    listen(window.visualViewport, 'resize', invalidateGeometry);
  }

  if (geometryCache !== null) {
    for (const type of GEOMETRY_EVENTS) {
      listen(document, type, invalidateGeometry);
    }

    listenOptional(document.fonts, 'loadingdone', invalidateGeometry);
    listenOptional(document.fonts, 'loadingerror', invalidateGeometry);
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
    const dirtyTargets = geometryCache?.consume() ?? null;

    if (dirtyTargets?.size === 0) {
      return true;
    }

    const roots = new Set<ShadowRoot>(dirtyTargets === null ? [] : scrollRoots);
    // A nested frame must not overwrite this frame's measurement scratch
    const measurement: MeasuredBounds = { measuredAt: now, minX: 0, minY: 0, maxX: 0, maxY: 0 };

    for (const target of snapshotTargets()) {
      if (!isRunning() || epoch !== generation) {
        return false;
      }

      if (!target.tracked || (dirtyTargets !== null && !dirtyTargets.has(target.id))) {
        continue;
      }

      let measured = false;

      try {
        measured = measureBounds(target.element, document, now, measurement);
      } catch (error) {
        if (epoch === generation) {
          target.bounds = null;
          target.snapshot = null;
          spatial?.delete(target.id);
          geometryCache?.invalidate();
        }

        reportError(error);
      }

      if (!isRunning() || epoch !== generation) {
        return false;
      }

      if (!target.tracked) {
        continue;
      }

      const previous = target.bounds;

      const changed =
        previous === null ||
        previous.minX !== measurement.minX ||
        previous.minY !== measurement.minY ||
        previous.maxX !== measurement.maxX ||
        previous.maxY !== measurement.maxY;

      if (measured) {
        const bounds = (target.bounds ??= { ...measurement });
        bounds.measuredAt = measurement.measuredAt;
        bounds.minX = measurement.minX;
        bounds.minY = measurement.minY;
        bounds.maxX = measurement.maxX;
        bounds.maxY = measurement.maxY;
      } else {
        target.bounds = null;
      }

      target.snapshot = null;

      if (target.bounds === null) {
        spatial?.delete(target.id);
      } else if (changed) {
        spatial?.set(target.id, target.bounds);
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

    geometryCache?.observeRoots(roots);

    for (const root of scrollRoots) {
      if (!roots.has(root)) {
        root.removeEventListener('scroll', invalidateGeometry, true);
        scrollRoots.delete(root);
      }
    }

    for (const root of roots) {
      if (!scrollRoots.has(root)) {
        root.addEventListener('scroll', invalidateGeometry, { capture: true, passive: true });
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
    frameHidden = document.hidden;

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

    if (scannableRuleCount === 0 && activeRuleCount === 0 && debugOptions === null) {
      requestFrame();

      return;
    }

    // Registration changes invalidate these limits, pointer frames do not
    if (ruleExtentsDirty) {
      maxHorizon = horizonMs;
      maxMargin = 0;

      for (const target of targets.values()) {
        for (const rule of target.rules) {
          if (rule.kind === 'intersection') {
            maxHorizon = Math.max(maxHorizon, rule.condition.withinMs);
            maxMargin = Math.max(maxMargin, rule.condition.marginPx);
          }
        }
      }

      ruleExtentsDirty = false;
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
      invalidateRules({ evaluatedAt: now, timeStamp: pointer.timeStamp });
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
    const finiteQuery = Object.values(conservativeQuery).every((value) => Number.isFinite(value));

    const candidates =
      spatial?.query(
        finiteQuery
          ? conservativeQuery
          : { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity },
      ) ?? new Set<number>();

    // No user code can run between this check and committing the shared miss
    if (
      spatial !== null &&
      candidates.size === 0 &&
      activeRuleCount === 0 &&
      predicateRuleCount === 0 &&
      debugOptions === null
    ) {
      allMissEvidence = pointer.timeStamp;
      allMissVersion = ++missVersion;
      requestFrame();

      return;
    }

    const frameTargets = snapshotTargets();
    let selected: number[] = [];

    for (let position = 0; position < frameTargets.length; position++) {
      const target = frameTargets[position];

      if (target === undefined) {
        continue;
      }

      const bounds = target.bounds;

      if (
        spatial === null &&
        (!finiteQuery ||
          (bounds !== null &&
            conservativeQuery.minX <= bounds.maxX &&
            conservativeQuery.maxX >= bounds.minX &&
            conservativeQuery.minY <= bounds.maxY &&
            conservativeQuery.maxY >= bounds.minY))
      ) {
        candidates.add(target.id);
      }

      if (
        debugOptions !== null ||
        target.predicates > 0 ||
        target.activeRules > 0 ||
        (target.scannableRules > 0 && candidates.has(target.id))
      ) {
        selected.push(position);
      }
    }

    if (debugOptions !== null) {
      debugCandidates = new Set(candidates);
    }

    const queue: (() => void)[] = [];
    // Commit cold misses in registration order, including across reentrant frames
    let cursor = 0;
    const version = selectionVersion;
    let scanningRemainder = false;

    for (let work = 0; work < selected.length; work++) {
      if (!isRunning() || epoch !== generation) {
        return;
      }

      const position = selected[work];

      if (position === undefined) {
        continue;
      }

      for (; cursor < position; cursor++) {
        recordMiss(frameTargets[cursor], pointer.timeStamp);
      }

      const target = frameTargets[position];

      if (target === undefined) {
        continue;
      }

      cursor = position + 1;
      let intersections: Map<number, Map<number, PredictionContext['intersection']>> | null = null;
      let contacts: Map<number, PredictionContext['intersection']> | null = null;

      for (const rule of snapshotRules(target)) {
        if (!isRunning() || epoch !== generation) {
          return;
        }

        if (!target.tracked || !rule.active) {
          continue;
        }

        applyMiss(target, rule);

        if (debugOptions === null && !rule.scannable && !rule.subscription.needsEvaluation) {
          rule.subscription.recordMiss(pointer.timeStamp);
          continue;
        }

        if (!target.bounds) {
          rule.subscription.evaluate(false, now, null, true, pointer.timeStamp);
          continue;
        }

        if (rule.kind === 'intersection' && !rule.subscription.latched) {
          rule.hysteresis.reset();
        }

        if (
          rule.kind === 'intersection' &&
          !candidates.has(target.id) &&
          !rule.subscription.latched
        ) {
          rule.subscription.evaluate(false, now, null, true, pointer.timeStamp);
          continue;
        }

        const horizon = rule.kind === 'intersection' ? rule.condition.withinMs : horizonMs;
        let forecast = forecasts.get(horizon);

        if (forecast === undefined) {
          forecast = predictor.predict(now, horizon);
          forecasts.set(horizon, forecast);
        }

        if (!forecast) {
          rule.subscription.evaluate(false, now, null, true, pointer.timeStamp);
          continue;
        }

        try {
          const rect = target.bounds;
          const margin = rule.kind === 'intersection' ? rule.condition.marginPx : 0;
          const targetRect = margin === 0 ? rect : expand(rect, margin);
          intersections ??= new Map();
          let byHorizon = intersections.get(margin);

          if (!byHorizon) {
            byHorizon = new Map<number, PredictionContext['intersection']>();
            intersections.set(margin, byHorizon);
          }

          let intersection = byHorizon.get(horizon);
          let observedContact = false;

          if (intersection === undefined) {
            const hit = candidates.has(target.id)
              ? predictor.intersectRect(now, horizon, targetRect)
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
              contact = observedIntersection(observed, targetRect);
              contacts.set(margin, contact);
            }

            intersection = contact ?? intersection;
            observedContact = contact !== null;
          }

          if (rule.kind === 'intersection' && intersection === null && rule.subscription.latched) {
            const age = now - pointer.timeStamp;

            const crossing =
              age > 0 ? predictor.intersectRect(pointer.timeStamp, age, targetRect) : null;

            if (crossing) {
              intersection = Object.freeze({ etaMs: 0, point: Object.freeze(crossing.point) });
            }
          }

          // Observed contact takes precedence over extrapolated departure
          if (
            rule.kind === 'intersection' &&
            (rule.condition.includeCurrent || rule.subscription.latched) &&
            pointer.x >= targetRect.minX &&
            pointer.x <= targetRect.maxX &&
            pointer.y >= targetRect.minY &&
            pointer.y <= targetRect.maxY
          ) {
            intersection = Object.freeze({
              etaMs: 0,
              point: Object.freeze({ x: pointer.x, y: pointer.y }),
            });
            observedContact = true;
          }

          if (rule.kind === 'intersection' && intersection === null) {
            const retained =
              rule.subscription.latched &&
              rule.hysteresis.retain(
                now,
                forecast,
                predictor.intersectRect(now, horizon, expand(rect, margin + RELEASE_MARGIN_PX)) !==
                  null,
              );

            if (retained && debugOptions !== null) {
              rule.debug = {
                matches: false,
                eligible: true,
                intersection: null,
              };
            }

            if (retained) {
              continue;
            }

            rule.subscription.evaluate(false, now, null, true, pointer.timeStamp);
            continue;
          }

          if (rule.kind === 'intersection') {
            rule.hysteresis.match(forecast, observedContact);
          }

          const context: PredictionContext = Object.freeze({
            element: target.element,
            ...(target.snapshot ??= snapshotBounds(target.bounds)),
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

            callback = rule.subscription.evaluate(
              intersection !== null,
              now,
              event,
              eligible,
              pointer.timeStamp,
              observedContact,
            );
          } else {
            const matches: unknown = rule.condition(context);

            if (typeof matches !== 'boolean') {
              void Promise.resolve(matches).catch(() => {});
              throw new TypeError('A condition must return a boolean synchronously.');
            }

            if (!isRunning() || epoch !== generation) {
              return;
            }

            if (!target.tracked || !rule.active) {
              continue;
            }

            if (debugOptions !== null) {
              rule.debug = { matches, eligible: matches, intersection };
            }

            callback = rule.subscription.evaluate(matches, now, context, true, pointer.timeStamp);
          }

          if (callback) {
            queue.push(callback);
          }
        } catch (error) {
          if (epoch === generation) {
            rule.subscription.evaluate(false, now, null, true, pointer.timeStamp);
          }

          reportError(error);
        }

        if (!isRunning() || epoch !== generation) {
          return;
        }
      }

      // A predicate or abort listener can activate a later target
      if (!scanningRemainder && version !== selectionVersion) {
        scanningRemainder = true;
        selected = [];

        for (let remaining = cursor; remaining < frameTargets.length; remaining++) {
          selected.push(remaining);
        }

        work = -1;
      }
    }

    if (!isRunning() || epoch !== generation) {
      return;
    }

    for (; cursor < frameTargets.length; cursor++) {
      recordMiss(frameTargets[cursor], pointer.timeStamp);
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

    rule.active = false;

    if (rule.scannable) {
      target.scannableRules--;
      scannableRuleCount--;
    }

    target.ruleList = null;
    selectionVersion++;

    if (rule.kind === 'predicate') {
      target.predicates--;
      predicateRuleCount--;
    }

    ruleExtentsDirty = true;

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

    const active = () => record.tracked;
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

      const evaluationStateChanged = (needsEvaluation: boolean) => {
        record.activeRules += needsEvaluation ? 1 : -1;
        activeRuleCount += needsEvaluation ? 1 : -1;

        if (
          rule.active &&
          rule.scannable &&
          rule.kind === 'intersection' &&
          rule.subscription.exhausted
        ) {
          rule.scannable = false;
          record.scannableRules--;
          scannableRuleCount--;
        }

        selectionVersion++;
      };

      if (typeof condition === 'function') {
        rule = {
          id: nextRuleId++,
          active: true,
          scannable: true,
          missVersion: Math.max(record.missVersion, allMissVersion),
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
            evaluationStateChanged,
          ),
        };
      } else {
        rule = {
          id: nextRuleId++,
          active: true,
          scannable: true,
          missVersion: Math.max(record.missVersion, allMissVersion),
          debug: null,
          kind: 'intersection',
          hysteresis: new IntersectionHysteresis(),
          condition: normalizeIntersectsCondition(condition),
          subscription: new Subscription<IntersectionContext>(
            callback,
            subscriptionOptions,
            reportError,
            publishDebug,
            evaluationStateChanged,
          ),
        };
      }

      record.rules.add(rule);
      record.scannableRules++;
      scannableRuleCount++;
      record.ruleList = null;

      if (rule.kind === 'predicate') {
        record.predicates++;
        predicateRuleCount++;
      }

      selectionVersion++;
      ruleExtentsDirty = true;

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
          ? getBoundsSnapshot(record)
          : null,
      invalidate: () => {
        if (active()) {
          geometryCache?.invalidateTarget(record.id);
          requestFrame();
        }
      },
      when,
      untrack: () => {
        if (!active()) {
          return;
        }

        record.tracked = false;
        targets.delete(element);
        spatial?.delete(record.id);
        geometryCache?.invalidate();
        targetList = null;
        selectionVersion++;
        resizeObserver?.unobserve(element);
        record.bounds = null;
        record.snapshot = null;

        for (const rule of [...record.rules]) {
          removeRule(record, rule);
        }

        record.rules.clear();

        if (targets.size === 0) {
          geometryCache?.observeRoots(new Set());
          resetInput();

          for (const root of scrollRoots) {
            root.removeEventListener('scroll', invalidateGeometry, true);
          }

          scrollRoots.clear();
        } else {
          requestFrame();
        }

        publishDebug();
      },
    });

    const record: TargetRecord = {
      id: nextId++,
      element,
      handle,
      bounds: null,
      snapshot: null,
      rules: new Set(),
      ruleList: null,
      tracked: true,
      activeRules: 0,
      scannableRules: 0,
      predicates: 0,
      missVersion: 0,
      missEvidence: null,
    };

    targets.set(element, record);
    targetList = null;
    selectionVersion++;
    resizeObserver?.observe(element);
    invalidateGeometry();

    return record.handle;
  }

  setDebug(initialDebug);

  return Object.freeze({
    invalidate: invalidateGeometry,
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
      geometryCache?.destroy();

      for (const root of scrollRoots) {
        root.removeEventListener('scroll', invalidateGeometry, true);
      }

      scrollRoots.clear();

      for (const target of snapshotTargets()) {
        target.handle.untrack();
      }
    },
  });
}
