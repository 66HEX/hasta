import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

for (const invalid of ['nonfinite', 'future', 'stale', 'out-of-order']) {
  test(`an ${invalid} move from another pointer cannot replace valid history`, async ({ page }) => {
    const result = await page.evaluate((invalid) => {
      const h = window.harness;
      const engine = h.createHasta();
      const signals = [];
      engine
        .track(h.element())
        .when({ type: 'intersects', withinMs: 120 }, ({ signal }) => signals.push(signal));
      h.pointer(1000, 0);
      h.pointer(1020, 20);
      h.frame();

      const timeStamp =
        invalid === 'future'
          ? 1040
          : invalid === 'stale'
            ? 900
            : invalid === 'out-of-order'
              ? 1010
              : NaN;

      h.pointer(1030, 500, 110, {
        pointerId: 2,
        coalesced: [{ x: 500, timeStamp }],
      });
      h.frame(1030);
      const active = signals.length === 1 && !signals[0].aborted;
      h.pointer(1040, 40);
      h.frame();
      const continued = signals.length === 1 && !signals[0].aborted;
      engine.destroy();

      return { active, continued, pending: h.pendingFrames() };
    }, invalid);

    expect(result).toEqual({ active: true, continued: true, pending: 0 });
  });
}

for (const type of [
  'pointercancel',
  'pointerdown',
  'pointerup',
  'lostpointercapture',
  'pointerout',
]) {
  test(`a stale ${type} from a replaced pointer does not cancel the current pointer`, async ({
    page,
  }) => {
    const result = await page.evaluate((type) => {
      const h = window.harness;
      const hasta = h.createHasta();
      const signals = [];
      hasta
        .track(h.element())
        .when({ type: 'intersects', withinMs: 120 }, ({ signal }) => signals.push(signal));
      h.pointer(1000, 0);
      h.pointer(1020, 20);
      h.frame();
      h.pointer(1040, 0, 110, { pointerId: 2 });
      h.frame();
      const switched = { count: signals.length, firstAborted: signals[0].aborted };
      h.pointer(1060, 20, 110, { pointerId: 2 });
      h.frame();
      h.pointer(1061, 20, 110, { pointerId: 1, type, relatedTarget: null });
      h.frame(1070);
      const preserved = { count: signals.length, secondAborted: signals[1].aborted };
      h.pointer(1071, 20, 110, { pointerId: 2, type, relatedTarget: null });
      const currentAborted = signals[1].aborted;
      hasta.destroy();

      return { switched, preserved, currentAborted, frames: h.pendingFrames() };
    }, type);

    expect(result).toEqual({
      switched: { count: 1, firstAborted: true },
      preserved: { count: 2, secondAborted: false },
      currentAborted: true,
      frames: 0,
    });
  });
}

test('unrelated touch and pen events neither reset nor feed the active mouse forecast', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta({ debug: true });
    const signals = [];
    hasta
      .track(h.element())
      .when({ type: 'intersects', withinMs: 120 }, ({ signal }) => signals.push(signal));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();

    for (const [pointerType, pointerId] of [
      ['touch', 2],
      ['pen', 3],
    ]) {
      for (const type of [
        'pointermove',
        'pointerdown',
        'pointerup',
        'pointercancel',
        'lostpointercapture',
        'pointerout',
      ]) {
        h.pointer(1030, 900, 900, { pointerType, pointerId, type, relatedTarget: null });
      }
    }

    h.frame(1040);
    const snapshot = hasta.getDebugSnapshot();
    const aborted = signals[0].aborted;
    hasta.destroy();

    return {
      count: signals.length,
      aborted,
      samples: snapshot.samples,
      start: snapshot.forecast.points[0],
      velocity: snapshot.velocity,
    };
  });

  expect(result).toEqual({
    count: 1,
    aborted: false,
    samples: [
      { x: 0, y: 110, timeStamp: 1000 },
      { x: 20, y: 110, timeStamp: 1020 },
    ],
    start: { x: 40, y: 110, offsetMs: 0 },
    velocity: { x: 1, y: 0, speed: 1 },
  });
});

test('focus changes inside the document do not act as window blur', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const first = document.createElement('input');
    const second = document.createElement('input');
    document.body.append(first, second);
    first.focus();
    const hasta = h.createHasta();
    const signals = [];
    hasta
      .track(h.element())
      .when({ type: 'intersects', withinMs: 120 }, ({ signal }) => signals.push(signal));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    second.focus();
    h.frame(1030);

    const local = {
      focused: document.activeElement === second,
      count: signals.length,
      aborted: signals[0].aborted,
    };

    window.dispatchEvent(new Event('blur'));
    const windowAborted = signals[0].aborted;
    hasta.destroy();

    return { local, windowAborted };
  });

  expect(result).toEqual({
    local: { focused: true, count: 1, aborted: false },
    windowAborted: true,
  });
});

test('pagehide aborts work and pageshow refreshes bounds without reviving the old forecast', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta({ debug: true });
    const element = h.element();
    const signals = [];
    const target = hasta.track(element);
    target.when({ type: 'intersects', withinMs: 120 }, ({ signal }) => signals.push(signal));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));

    const hidden = {
      aborted: signals[0].aborted,
      frames: h.pendingFrames(),
      forecast: hasta.getDebugSnapshot().forecast,
    };

    element.style.left = '120px';
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    h.frame(1030);

    const restored = {
      x: target.getBounds().rect.minX,
      count: signals.length,
      forecast: hasta.getDebugSnapshot().forecast,
    };

    h.pointer(1040, 0);
    h.frame();
    const warmupCount = signals.length;
    h.pointer(1060, 20);
    h.frame();
    hasta.destroy();

    return { hidden, restored, warmupCount, count: signals.length, frames: h.pendingFrames() };
  });

  expect(result).toEqual({
    hidden: { aborted: true, frames: 0, forecast: null },
    restored: { x: 120, count: 1, forecast: null },
    warmupCount: 1,
    count: 2,
    frames: 0,
  });
});

test('pointer lock discards absolute coordinates and unlock requires two fresh samples', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const element = h.element();
    const signals = [];
    hasta
      .track(element)
      .when({ type: 'intersects', withinMs: 120 }, ({ signal }) => signals.push(signal));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: element });
    document.dispatchEvent(new Event('pointerlockchange'));
    const lockedAborted = signals[0].aborted;
    h.pointer(1030, 0);
    h.pointer(1050, 20);
    h.frame();
    const lockedCount = signals.length;
    Object.defineProperty(document, 'pointerLockElement', { configurable: true, value: null });
    document.dispatchEvent(new Event('pointerlockchange'));
    h.pointer(1060, 0);
    h.frame();
    const warmupCount = signals.length;
    h.pointer(1080, 20);
    h.frame();
    hasta.destroy();

    return {
      lockedAborted,
      lockedCount,
      warmupCount,
      count: signals.length,
      frames: h.pendingFrames(),
    };
  });

  expect(result).toEqual({
    lockedAborted: true,
    lockedCount: 1,
    warmupCount: 1,
    count: 2,
    frames: 0,
  });
});

test('invalid, future and out-of-order coalesced samples leave valid history intact', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta({ debug: true });
    const hits = [];
    hasta
      .track(h.element())
      .when({ type: 'intersects', withinMs: 120 }, (event) => hits.push(event.etaMs));
    h.pointer(1000, 0);
    h.pointer(1020, 20);

    const event = new PointerEvent('pointermove', {
      pointerId: 1,
      pointerType: 'mouse',
      bubbles: true,
    });

    Object.defineProperty(event, 'getCoalescedEvents', {
      value: () => [
        { clientX: NaN, clientY: 110, timeStamp: 1020 },
        { clientX: 900, clientY: Infinity, timeStamp: 1020 },
        { clientX: 900, clientY: 110, timeStamp: NaN },
        { clientX: 900, clientY: 110, timeStamp: -1 },
        { clientX: 900, clientY: 110, timeStamp: 1010 },
        { clientX: 900, clientY: 110, timeStamp: 2000 },
        { clientX: 20, clientY: 110, timeStamp: 1020 },
      ],
    });
    document.dispatchEvent(event);
    h.frame();
    const snapshot = hasta.getDebugSnapshot();
    hasta.destroy();

    return { hits, samples: snapshot.samples, velocity: snapshot.velocity };
  });

  expect(result).toEqual({
    hits: [80],
    samples: [
      { x: 0, y: 110, timeStamp: 1000 },
      { x: 20, y: 110, timeStamp: 1020 },
    ],
    velocity: { x: 1, y: 0, speed: 1 },
  });
});

test('destroy releases listeners and observers after repeated active instances', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const nativeAdd = EventTarget.prototype.addEventListener;
    const nativeRemove = EventTarget.prototype.removeEventListener;
    const owned = new Map();
    const observed = new Set();
    let disconnects = 0;

    const capture = (options) =>
      typeof options === 'boolean' ? options : Boolean(options?.capture);

    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if ([window, document, window.visualViewport].includes(this)) {
        owned.set(listener, [
          ...(owned.get(listener) ?? []),
          { target: this, type, capture: capture(options) },
        ]);
      }

      return nativeAdd.call(this, type, listener, options);
    };

    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      const registrations = owned.get(listener);

      if (registrations) {
        const remaining = registrations.filter(
          (item) => item.target !== this || item.type !== type || item.capture !== capture(options),
        );

        if (remaining.length > 0) {
          owned.set(listener, remaining);
        } else {
          owned.delete(listener);
        }
      }

      return nativeRemove.call(this, type, listener, options);
    };

    const NativeResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class extends NativeResizeObserver {
      observe(element, options) {
        observed.add(element);
        super.observe(element, options);
      }
      unobserve(element) {
        observed.delete(element);
        super.unobserve(element);
      }
      disconnect() {
        disconnects++;
        observed.clear();
        super.disconnect();
      }
    };
    let aborts = 0;
    let callbacks = 0;

    try {
      for (let i = 0; i < 12; i++) {
        const hasta = h.createHasta({ debug: true });
        const element = h.element();
        // oxlint-disable-next-line no-loop-func -- Shared counters intentionally accumulate callbacks from all instances
        hasta.track(element).when({ type: 'intersects', withinMs: 120 }, ({ signal }) => {
          callbacks++;
          signal.addEventListener(
            'abort',
            () => {
              aborts++;
            },
            { once: true },
          );
        });
        h.pointer(1000 + i * 50, 0);
        h.pointer(1020 + i * 50, 20);
        h.frame();
        hasta.destroy();
        hasta.destroy();
        element.remove();
      }

      h.pointer(1700, 20);
      window.dispatchEvent(new Event('resize'));
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      document.dispatchEvent(new Event('scroll'));
      h.frame();

      return {
        callbacks,
        aborts,
        listeners: owned.size,
        observed: observed.size,
        disconnects,
        frames: h.pendingFrames(),
        overlays: document.querySelectorAll('[data-hasta-debug]').length,
      };
    } finally {
      EventTarget.prototype.addEventListener = nativeAdd;
      EventTarget.prototype.removeEventListener = nativeRemove;
      window.ResizeObserver = NativeResizeObserver;
    }
  });

  expect(result).toEqual({
    callbacks: 12,
    aborts: 12,
    listeners: 0,
    observed: 0,
    disconnects: 12,
    frames: 0,
    overlays: 0,
  });
});
