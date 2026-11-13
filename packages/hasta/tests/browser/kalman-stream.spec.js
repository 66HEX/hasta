import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

test('high-rate curved input reaches the Kalman predictor regardless of event and frame grouping', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { KalmanPredictor } = await import('/dist/core/index.js');
    const h = window.harness;
    const horizonMs = 80;

    const history = Array.from({ length: 256 }, (_, index) => ({
      timeStamp: 1000 + index / 8,
      x: 100 + index * 0.3 + 0.15 * Math.sin(index * 2.7),
      y: 110 + index * 0.08 + 4 * Math.sin(index / 19) + 0.1 * Math.cos(index * 1.9),
    }));

    const last = history.at(-1);
    const now = last.timeStamp + 3;
    const reference = new KalmanPredictor();
    history.forEach((sample) => reference.update(sample));
    const expected = reference.predict(now, horizonMs);
    const truncated = new KalmanPredictor();
    history.slice(-2).forEach((sample) => truncated.update(sample));
    const runs = [];

    for (const delivery of ['separate', 'coalesced', 'frame-batches']) {
      const engine = h.createHasta({ debug: true, horizonMs });
      const element = h.element();
      engine.track(element);

      if (delivery === 'separate') {
        history.forEach((sample) => h.pointer(sample.timeStamp, sample.x, sample.y));
      } else {
        const size = delivery === 'coalesced' ? history.length : 13;

        for (let index = 0; index < history.length; index += size) {
          const batch = history.slice(index, index + size);
          const latest = batch.at(-1);
          h.pointer(latest.timeStamp, latest.x, latest.y, { coalesced: batch });

          if (delivery === 'frame-batches') {
            h.frame(latest.timeStamp);
          }
        }
      }

      h.frame(now);
      const snapshot = engine.getDebugSnapshot();
      engine.destroy();
      element.remove();
      runs.push({
        delivery,
        forecast: snapshot.forecast,
        status: snapshot.status,
        pointer: snapshot.pointer,
        historyLength: snapshot.samples.length,
        pendingFrames: h.pendingFrames(),
      });
    }

    return { expected, truncated: truncated.predict(now, horizonMs), last, runs };
  });

  expect(result.expected).not.toBeNull();
  expect(result.expected).not.toEqual(result.truncated);

  for (const run of result.runs) {
    expect(run.forecast, run.delivery).toEqual(result.expected);
    expect(run.status, run.delivery).toBe('tracking');
    expect(run.pointer, run.delivery).toEqual(result.last);
    expect(run.historyLength, run.delivery).toBe(32);
    expect(run.pendingFrames, run.delivery).toBe(0);
  }
});

test('same-time corrections roll back Kalman state across frames and reject invalid input', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { KalmanPredictor } = await import('/dist/core/index.js');
    const h = window.harness;
    const horizonMs = 60;

    const history = Array.from({ length: 48 }, (_, index) => ({
      timeStamp: 1000 + index,
      x: 80 + index * 0.7 + Math.sin(index / 5),
      y: 110 + Math.sin(index / 7) * 3,
    }));

    const last = history.at(-1);
    const next = { x: 115, y: 112, timeStamp: last.timeStamp + 1 };
    const reference = new KalmanPredictor();
    history.forEach((sample) => reference.update(sample));
    const expected = reference.predict(last.timeStamp, horizonMs);
    reference.update(next);
    const expectedNext = reference.predict(next.timeStamp + 2, horizonMs);
    const runs = [];

    for (const delivery of ['before-frame', 'between-frames', 'coalesced']) {
      const engine = h.createHasta({ debug: true, horizonMs });
      const element = h.element();
      engine.track(element);

      for (const sample of history) {
        const discarded = { ...sample, x: sample.x + 1000, y: sample.y - 1000 };

        if (delivery === 'coalesced') {
          h.pointer(sample.timeStamp, sample.x, sample.y, {
            coalesced: [discarded, sample],
          });
        } else {
          h.pointer(discarded.timeStamp, discarded.x, discarded.y);

          if (delivery === 'between-frames') {
            h.frame(sample.timeStamp);
          }

          h.pointer(sample.timeStamp, sample.x, sample.y);
        }

        const invalid = new PointerEvent('pointermove', {
          pointerId: 1,
          pointerType: 'mouse',
          buttons: 0,
        });

        Object.defineProperty(invalid, 'getCoalescedEvents', {
          value: () => [
            { clientX: NaN, clientY: 0, timeStamp: sample.timeStamp },
            { clientX: 0, clientY: Infinity, timeStamp: sample.timeStamp },
            { clientX: 0, clientY: 0, timeStamp: NaN },
            { clientX: 10000, clientY: -10000, timeStamp: sample.timeStamp - 0.5 },
            { clientX: 10000, clientY: -10000, timeStamp: sample.timeStamp + 1000 },
          ],
        });
        document.dispatchEvent(invalid);
      }

      h.frame(last.timeStamp);
      const corrected = engine.getDebugSnapshot().forecast;
      h.pointer(next.timeStamp, next.x, next.y);
      h.frame(next.timeStamp + 2);
      const continued = engine.getDebugSnapshot().forecast;
      engine.destroy();
      element.remove();
      runs.push({ delivery, corrected, continued, pendingFrames: h.pendingFrames() });
    }

    return { expected, expectedNext, runs };
  });

  expect(result.expected).not.toBeNull();
  expect(result.expectedNext).not.toBeNull();

  for (const run of result.runs) {
    expect(run.corrected, run.delivery).toEqual(result.expected);
    expect(run.continued, run.delivery).toEqual(result.expectedNext);
    expect(run.pendingFrames, run.delivery).toBe(0);
  }
});

test('pause clears learned Kalman motion and ignored input before a fresh session', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { KalmanPredictor } = await import('/dist/core/index.js');
    const h = window.harness;
    const horizonMs = 90;
    const engine = h.createHasta({ debug: true, horizonMs });
    const element = h.element();
    const signals = [];
    engine.track(element).when(
      () => true,
      ({ signal }) => signals.push(signal),
    );

    for (let index = 0; index < 48; index++) {
      h.pointer(1000 + index, 600 - index * 2, 300 + Math.sin(index / 4));
    }

    h.frame();
    const oldCount = signals.length;
    engine.pause();
    const cancelled = signals.every((signal) => signal.aborted);

    for (let index = 0; index < 16; index++) {
      h.pointer(1050 + index, -500 + index, -500);
    }

    h.frame();
    const paused = engine.getDebugSnapshot();
    engine.resume();

    const fresh = Array.from({ length: 48 }, (_, index) => ({
      timeStamp: 1070 + index / 2,
      x: 10 + index * 0.6 + Math.sin(index / 5) * 0.2,
      y: 110 + Math.sin(index / 9),
    }));

    const first = fresh[0];
    h.pointer(first.timeStamp, first.x, first.y);
    h.frame();
    const warming = engine.getDebugSnapshot();
    const afterOne = signals.length;
    const last = fresh.at(-1);
    h.pointer(last.timeStamp, last.x, last.y, { coalesced: fresh.slice(1) });
    const now = last.timeStamp + 2;
    h.frame(now);
    const actual = engine.getDebugSnapshot().forecast;
    const reference = new KalmanPredictor();
    fresh.forEach((sample) => reference.update(sample));
    const expected = reference.predict(now, horizonMs);
    const active = signals.map((signal) => !signal.aborted);
    engine.destroy();
    element.remove();

    return {
      oldCount,
      cancelled,
      paused: { status: paused.status, forecast: paused.forecast },
      warming: { status: warming.status, forecast: warming.forecast },
      afterOne,
      active,
      actual,
      expected,
      pendingFrames: h.pendingFrames(),
    };
  });

  expect(result.oldCount).toBe(1);
  expect(result.cancelled).toBe(true);
  expect(result.paused).toEqual({ status: 'paused', forecast: null });
  expect(result.warming).toEqual({ status: 'warming-up', forecast: null });
  expect(result.afterOne).toBe(1);
  expect(result.active).toEqual([false, true]);
  expect(result.expected).not.toBeNull();
  expect(result.actual).toEqual(result.expected);
  expect(result.pendingFrames).toBe(0);
});

test('input dispatched by a predicate affects the next Kalman frame without mixing rule forecasts', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { KalmanPredictor } = await import('/dist/core/index.js');
    const h = window.harness;
    const horizonMs = 120;
    const engine = h.createHasta({ debug: true, horizonMs });
    const first = h.element();
    const second = h.element();
    const forecasts = [];
    const events = [];

    const injected = [
      { x: 200, y: 110, timeStamp: 1030 },
      { x: 180, y: 110, timeStamp: 1040 },
    ];

    engine.track(first).when(
      (context) => {
        forecasts.push(context.forecast);

        if (forecasts.length === 1) {
          injected.forEach((sample) => h.pointer(sample.timeStamp, sample.x, sample.y));
        }

        return false;
      },
      () => {},
    );
    engine.track(second).when({ type: 'intersects', withinMs: horizonMs }, (event) => {
      events.push({
        forecast: event.forecast,
        evaluatedAt: event.evaluatedAt,
        predictedAt: event.predictedAt,
        intersection: event.intersection,
      });
    });
    const reference = new KalmanPredictor();

    for (const sample of [
      { x: 0, y: 110, timeStamp: 1000 },
      { x: 20, y: 110, timeStamp: 1020 },
    ]) {
      reference.update(sample);
      h.pointer(sample.timeStamp, sample.x, sample.y);
    }

    const expectedBefore = reference.predict(1020, horizonMs);

    const hit = reference.intersectRect(1020, horizonMs, {
      minX: 100,
      minY: 100,
      maxX: 110,
      maxY: 120,
    });

    h.frame(1020);
    const firstFrameEvents = [...events];
    injected.forEach((sample) => reference.update(sample));
    const expectedAfter = reference.predict(1040, horizonMs);
    h.frame(1040);
    const after = engine.getDebugSnapshot().forecast;
    engine.destroy();
    first.remove();
    second.remove();

    return {
      expectedBefore,
      expectedAfter,
      expectedHit: hit,
      forecasts,
      firstFrameEvents,
      after,
      pendingFrames: h.pendingFrames(),
    };
  });

  expect(result.expectedHit).not.toBeNull();
  expect(result.expectedAfter).not.toBeNull();
  expect(result.forecasts).toEqual([result.expectedBefore, result.expectedAfter]);
  expect(result.firstFrameEvents).toEqual([
    {
      forecast: result.expectedBefore,
      evaluatedAt: 1020,
      predictedAt: 1020 + result.expectedHit.offsetMs,
      intersection: { etaMs: result.expectedHit.offsetMs, point: result.expectedHit.point },
    },
  ]);
  expect(result.after).toEqual(result.expectedAfter);
  expect(result.pendingFrames).toBe(0);
});
