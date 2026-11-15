import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

test('samples that expire during layout measurement cannot start a forecast', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element();
    const measure = element.getBoundingClientRect.bind(element);
    element.getBoundingClientRect = () => {
      h.frame(1140);

      return measure();
    };

    let calls = 0;
    engine.track(element).when({ type: 'intersects', withinMs: 120 }, () => calls++);
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const pending = h.pendingFrames();
    engine.destroy();

    return { calls, pending };
  });

  expect(result).toEqual({ calls: 0, pending: 0 });
});

test('forecast ETA includes time spent measuring layout', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element();
    const measure = element.getBoundingClientRect.bind(element);
    element.getBoundingClientRect = () => {
      h.frame(1040);

      return measure();
    };

    const events = [];
    engine
      .track(element)
      .when({ type: 'intersects', withinMs: 120 }, (event) =>
        events.push({ eta: event.etaMs, at: event.evaluatedAt, predictedAt: event.predictedAt }),
      );
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    engine.destroy();

    return events;
  });

  expect(result).toEqual([{ eta: 60, at: 1040, predictedAt: 1100 }]);
});

test('a failed DOM measurement recovers bounds immediately and predictions on fresh input', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const errors = [];
    const engine = h.createHasta({ onError: (error) => errors.push(error.message) });
    const bad = h.element();
    const measure = bad.getBoundingClientRect.bind(bad);
    bad.getBoundingClientRect = () => {
      throw new Error('layout failed');
    };

    const target = engine.track(bad);
    let goodCalls = 0;
    let recoveredCalls = 0;
    target.when({ type: 'intersects', withinMs: 120 }, () => {
      recoveredCalls++;
    });
    engine.track(h.element()).when({ type: 'intersects', withinMs: 120 }, () => {
      goodCalls++;
    });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const failedBounds = target.getBounds();
    const framesAfterFailure = h.pendingFrames();
    bad.getBoundingClientRect = measure;
    h.frame(1030);
    const repairedBounds = target.getBounds();
    const idle = recoveredCalls;
    h.pointer(1031, 31);
    h.frame();
    engine.destroy();

    return {
      errors,
      goodCalls,
      recoveredCalls,
      idle,
      failedBounds,
      framesAfterFailure,
      repaired: repairedBounds !== null,
      remainingFrames: h.pendingFrames(),
    };
  });

  expect(result).toEqual({
    errors: ['layout failed'],
    goodCalls: 1,
    recoveredCalls: 1,
    idle: 0,
    failedBounds: null,
    framesAfterFailure: 1,
    repaired: true,
    remainingFrames: 0,
  });
});

test('an error handler destroying the instance stops the remaining geometry reads', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta({ onError: () => engine.destroy() });
    const bad = h.element();
    bad.getBoundingClientRect = () => {
      throw new Error('layout failed');
    };

    engine.track(bad);
    let reads = 0;
    const other = h.element();
    other.getBoundingClientRect = () => {
      reads++;

      return new DOMRect(100, 100, 10, 20);
    };

    engine.track(other);
    h.frame();

    return { reads, frames: h.pendingFrames() };
  });

  expect(result).toEqual({ reads: 0, frames: 0 });
});

test('unchanged bounds keep a fresh timestamp and preserve earlier snapshots', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.harness;
    const engine = h.createHasta({ bounds: 'frame' });

    try {
      const element = h.element();
      const target = engine.track(element);
      h.frame();
      const original = target.getBounds();
      h.pointer(1010, 0);
      h.pointer(1020, 20);
      h.frame();
      h.frame(1030);
      const unchanged = { measuredAt: target.getBounds().measuredAt };
      element.style.left = '200px';
      h.frame(1040);

      return {
        unchanged,
        currentX: target.getBounds().rect.minX,
        originalX: original.rect.minX,
        originalTime: original.measuredAt,
      };
    } finally {
      engine.destroy();
    }
  });

  expect(result).toEqual({
    unchanged: { measuredAt: 1030 },
    currentX: 200,
    originalX: 100,
    originalTime: 1000,
  });
});

test('a large input burst retains the final distinct samples and exact CV forecast', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta({ debug: true });
    engine.track(h.element());

    const coalesced = Array.from({ length: 10000 }, (_, index) => ({
      timeStamp: 1000 + index / 200,
      x: index / 100,
    }));

    h.pointer(1050, 100, 110, { coalesced });
    h.frame(1050);
    const snapshot = engine.getDebugSnapshot();
    engine.destroy();

    return {
      status: snapshot.status,
      x: snapshot.forecast.points[0].x,
      endX: snapshot.forecast.points[1].x,
      velocity: snapshot.velocity.x,
      history: snapshot.samples.length,
      frames: h.pendingFrames(),
    };
  });

  expect(result.status).toBe('tracking');
  expect(result.x).toBeCloseTo(100, 8);
  expect(result.endX).toBeCloseTo(340, 7);
  expect(result.velocity).toBeCloseTo(2, 8);
  expect(result.history).toBe(32);
  expect(result.frames).toBe(0);
});

test('an overflowing forecast does not suppress ordinary independent rules', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const errors = [];
    const engine = h.createHasta({ debug: true, onError: (error) => errors.push(error.message) });
    const target = engine.track(h.element());
    const events = [];
    target.when({ type: 'intersects', withinMs: Number.MAX_VALUE }, () => events.push('overflow'));
    target.when({ type: 'intersects', withinMs: 120 }, (event) => events.push(event.etaMs));
    target.when(
      (context) => context.intersection !== null,
      () => events.push('predicate'),
    );
    h.pointer(1000, 0);
    h.pointer(1020, 40);
    h.frame();
    const forecast = engine.getDebugSnapshot().forecast;
    engine.destroy();

    return { events, errors, horizon: forecast.points[1].offsetMs };
  });

  expect(result).toEqual({ events: [30, 'predicate'], errors: [], horizon: 120 });
});

test('identical rules keep separate cooldown, once and cancellation state', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element();
    const target = engine.track(element);
    const events = [];
    target.when(
      { type: 'intersects', withinMs: 120 },
      (event) => {
        events.push(['first', event.etaMs]);
        disposeSecond();
      },
      { once: true },
    );

    const disposeSecond = target.when({ type: 'intersects', withinMs: 120 }, () =>
      events.push(['disposed']),
    );

    target.when(
      { type: 'intersects', withinMs: 120 },
      (event) => events.push(['third', event.etaMs]),
      { cooldownMs: 30 },
    );
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    element.style.left = '1000px';
    h.pointer(1030, 30);
    h.frame();
    element.style.left = '100px';
    h.pointer(1040, 40);
    h.frame();
    const beforeCooldown = events.length;
    h.frame(1050);
    const waiting = events.length;
    h.pointer(1050, 50);
    h.frame();
    engine.destroy();

    return { events, beforeCooldown, waiting };
  });

  expect(result).toEqual({
    beforeCooldown: 2,
    waiting: 2,
    events: [
      ['first', 80],
      ['third', 80],
      ['third', 50],
    ],
  });
});

test('untracking and re-registering the same element cannot invoke its old queued callbacks', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta({ debug: true });
    const first = engine.track(h.element());
    const element = h.element();
    const old = engine.track(element);
    const calls = [];
    let replacement;
    first.when(
      { type: 'intersects', withinMs: 120 },
      () => {
        old.untrack();
        replacement = engine.track(element);
        replacement.when({ type: 'intersects', withinMs: 120 }, () => calls.push('replacement'));
      },
      { once: true },
    );
    old.when({ type: 'intersects', withinMs: 120 }, () => calls.push('old'));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const firstFrame = [...calls];
    old.untrack();
    h.frame(1030);
    const tracked = engine.getDebugSnapshot().targets.length;
    const oldBounds = old.getBounds();
    const replaced = replacement !== old && replacement === engine.track(element);
    engine.destroy();

    return { firstFrame, calls, tracked, oldBounds, replaced, frames: h.pendingFrames() };
  });

  expect(result).toEqual({
    firstFrame: [],
    calls: ['replacement'],
    tracked: 2,
    oldBounds: null,
    replaced: true,
    frames: 0,
  });
});

test('an abort listener can pause and resume without leaking the previous evaluation queue', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const first = engine.track(h.element());
    const calls = [];
    first.when({ type: 'intersects', withinMs: 120 }, ({ signal }) => {
      calls.push('first');
      signal.addEventListener(
        'abort',
        () => {
          engine.pause();
          engine.resume();
        },
        { once: true },
      );
    });
    engine
      .track(h.element({ x: 0 }))
      .when({ type: 'intersects', withinMs: 120 }, () => calls.push('second'));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.pointer(1030, 10);
    h.frame();
    const afterReset = [...calls];
    h.pointer(1040, 0);
    h.frame();
    engine.destroy();

    return { afterReset, calls, frames: h.pendingFrames() };
  });

  expect(result).toEqual({ afterReset: ['first'], calls: ['first'], frames: 0 });
});
