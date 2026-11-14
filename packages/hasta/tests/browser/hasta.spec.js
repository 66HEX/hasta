import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

test('measures actual DOM bounds asynchronously and returns immutable snapshots', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const element = h.element({ x: 125.5, y: 70, width: 33, height: 21 });
    const target = hasta.track(element);
    const initial = target.getBounds();
    h.frame();
    const measured = target.getBounds();
    const same = hasta.track(element) === target;
    hasta.destroy();

    return {
      initial,
      measured,
      same,
      frozen: Object.isFrozen(measured) && Object.isFrozen(measured.rect),
    };
  });

  expect(result).toEqual({
    initial: null,
    measured: { rect: { minX: 125.5, minY: 70, maxX: 158.5, maxY: 91 }, measuredAt: 1000 },
    same: true,
    frozen: true,
  });
});

test('finds a crossing between outside endpoints with ETA measured from evaluation', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const events = [];
    hasta.track(h.element()).when({ type: 'intersects', withinMs: 120 }, (event) => {
      events.push({
        eta: event.etaMs,
        at: event.predictedAt,
        evaluated: event.evaluatedAt,
        points: event.forecast.points,
        frozen: Object.isFrozen(event.forecast.points[0]),
      });
    });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame(1030);
    hasta.destroy();

    return events;
  });

  expect(result).toEqual([
    {
      eta: 70,
      at: 1100,
      evaluated: 1030,
      points: [
        { x: 30, y: 110, offsetMs: 0 },
        { x: 150, y: 110, offsetMs: 120 },
      ],
      frozen: true,
    },
  ]);
});

test('respects each horizon and includes margin in candidate selection', async ({ page }) => {
  const events = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const target = hasta.track(h.element());
    const fired = [];
    target.when({ type: 'intersects', withinMs: 60 }, () => fired.push('short'));
    target.when({ type: 'intersects', withinMs: 120 }, () => fired.push('long'));
    target.when({ type: 'intersects', withinMs: 60, marginPx: 30 }, (e) =>
      fired.push(`margin:${e.etaMs}`),
    );
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    hasta.destroy();

    return fired;
  });

  expect(events).toEqual(['long', 'margin:50']);
});

test('gates starting inside but preserves an episode when the cursor reaches its target', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const target = hasta.track(h.element({ width: 100 }));
    const events = [];
    target.when({ type: 'intersects', withinMs: 120 }, (event) => events.push(event));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.pointer(1100, 100);
    h.frame();
    const reached = { count: events.length, aborted: events[0].signal.aborted };
    let current = 0;
    let suppressed = 0;
    target.when({ type: 'intersects', withinMs: 120, includeCurrent: true }, () => current++);
    target.when({ type: 'intersects', withinMs: 120 }, () => suppressed++);
    h.frame(1101);
    hasta.destroy();

    return { reached, current, suppressed };
  });

  expect(result).toEqual({ reached: { count: 1, aborted: false }, current: 1, suppressed: 0 });
});

test('updates bounds after layout shifts and transforms without size changes', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const element = h.element({ x: 300 });
    const target = hasta.track(element);
    const hits = [];
    target.when({ type: 'intersects', withinMs: 120 }, (e) => hits.push(e.rect.minX));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const before = target.getBounds();
    element.style.left = '200px';
    element.style.transform = 'translateX(-100px)';
    h.frame(1030);
    const after = target.getBounds();
    const waiting = [...hits];
    h.pointer(1031, 31);
    h.frame();
    hasta.destroy();

    return { before, after, hits, waiting };
  });

  expect(result.before.rect.minX).toBe(300);
  expect(result.after.rect.minX).toBe(100);
  expect(result.waiting).toEqual([]);
  expect(result.hits).toEqual([100]);
});

test('remeasures nested scrolling and explicit invalidation while idle', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const container = document.createElement('div');
    Object.assign(container.style, {
      position: 'absolute',
      left: '50px',
      top: '30px',
      width: '200px',
      height: '100px',
      overflow: 'auto',
    });
    const content = document.createElement('div');
    Object.assign(content.style, { position: 'relative', width: '1000px', height: '500px' });
    container.append(content);
    document.body.append(container);
    const hasta = h.createHasta();
    const element = h.element({ x: 100, y: 60, parent: content });
    const target = hasta.track(element);
    h.frame();
    const before = target.getBounds().rect;
    container.scrollLeft = 40;
    container.scrollTop = 20;
    container.dispatchEvent(new Event('scroll'));
    h.frame(1010);
    const scrolled = target.getBounds().rect;
    element.style.left = '140px';
    target.invalidate();
    h.frame(1020);
    const invalidated = target.getBounds().rect;
    hasta.destroy();

    return { before, scrolled, invalidated };
  });

  expect(result.before.minX).toBe(150);
  expect(result.before.minY).toBe(90);
  expect(result.scrolled.minX).toBe(110);
  expect(result.scrolled.minY).toBe(70);
  expect(result.invalidated.minX).toBe(150);
});

test('parks detached and zero-size elements and measures reconnected elements', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const element = h.element();
    const target = hasta.track(element);
    const events = [];
    target.when({ type: 'intersects', withinMs: 120 }, (e) => events.push(e));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    element.remove();
    h.frame(1030);
    const detached = target.getBounds();
    const aborted = events[0].signal.aborted;
    document.body.append(element);
    h.frame(1040);
    const reconnected = target.getBounds();
    const waiting = events.length;
    h.pointer(1041, 41);
    h.frame();
    element.style.display = 'none';
    h.frame(1050);
    const hidden = target.getBounds();
    hasta.destroy();

    return { detached, aborted, reconnected, hidden, count: events.length, waiting };
  });

  expect(result.detached).toBeNull();
  expect(result.aborted).toBe(true);
  expect(result.reconnected.rect.minX).toBe(100);
  expect(result.hidden).toBeNull();
  expect(result.waiting).toBe(1);
  expect(result.count).toBe(2);
});

test('measures reparented targets inside a shadow root during active tracking', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const element = h.element();
    const target = hasta.track(element);
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'absolute', left: '200px', top: '0px' });
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const before = target.getBounds().rect.minX;
    element.style.position = 'absolute';
    shadow.append(element);
    h.frame(1030);
    const after = target.getBounds().rect.minX;
    hasta.destroy();

    return { before, after };
  });

  expect(result).toEqual({ before: 100, after: 300 });
});

test('deduplicates a true episode, aborts on reversal and rearms on a new approach', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const events = [];
    hasta.track(h.element()).when({ type: 'intersects', withinMs: 120 }, (e) => events.push(e));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.frame(1030);
    h.frame(1040);
    const firstCount = events.length;
    h.pointer(1050, 10);
    h.frame();
    const aborted = events[0].signal.aborted;
    h.pointer(1060, 20);
    h.frame();
    const secondCount = events.length;
    hasta.destroy();

    return { firstCount, aborted, secondCount };
  });

  expect(result).toEqual({ firstCount: 1, aborted: true, secondCount: 2 });
});

test('expires a once callback and stops animation frames without another pointer event', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta({ maxSampleAgeMs: 100 });
    const events = [];
    hasta
      .track(h.element())
      .when({ type: 'intersects', withinMs: 120 }, (e) => events.push(e), { once: true });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.frame(1120);
    const expired = events[0].signal.aborted;
    const idleFrames = h.pendingFrames();
    h.pointer(1200, 0);
    h.pointer(1220, 20);
    h.frame();
    hasta.destroy();

    return { expired, idleFrames, count: events.length };
  });

  expect(result).toEqual({ expired: true, idleFrames: 0, count: 1 });
});

test('pause, untrack and destroy cancel work and require fresh input on resume', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const target = hasta.track(h.element());
    const events = [];
    target.when({ type: 'intersects', withinMs: 120 }, (e) => events.push(e));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    hasta.pause();
    const paused = events[0].signal.aborted;
    hasta.resume();
    h.pointer(1030, 0);
    h.frame();
    const warmupCount = events.length;
    h.pointer(1050, 20);
    h.frame();
    target.untrack();
    const untracked = events[1].signal.aborted;
    target.untrack();
    hasta.destroy();
    hasta.destroy();
    h.pointer(1070, 40);
    h.frame();

    return { paused, warmupCount, untracked, count: events.length, frames: h.pendingFrames() };
  });

  expect(result).toEqual({ paused: true, warmupCount: 1, untracked: true, count: 2, frames: 0 });
});

test('takes all geometry snapshots before callbacks and cancels queued work after untrack', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const first = hasta.track(h.element());
    const secondElement = h.element();
    const second = hasta.track(secondElement);
    const third = hasta.track(h.element());
    const events = [];
    first.when({ type: 'intersects', withinMs: 120 }, () => {
      secondElement.style.left = '800px';
      third.untrack();
      events.push('first');
    });
    second.when({ type: 'intersects', withinMs: 120 }, (e) => events.push(`second:${e.rect.minX}`));
    third.when({ type: 'intersects', withinMs: 120 }, () => events.push('third'));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    hasta.destroy();

    return events;
  });

  expect(result).toEqual(['first', 'second:100']);
});

test('uses coalesced samples instead of the parent event and ignores browser predictions', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const hits = [];
    hasta.track(h.element()).when({ type: 'intersects', withinMs: 120 }, (e) => hits.push(e.etaMs));
    h.pointer(1020, 900, 500, {
      coalesced: [
        { x: 0, y: 110, timeStamp: 1000 },
        { x: 20, y: 110, timeStamp: 1020 },
      ],
      predicted: [new PointerEvent('pointermove', { clientX: 900, clientY: 500 })],
    });
    h.frame();
    hasta.destroy();

    return hits;
  });

  expect(result).toEqual([80]);
});

test('pointer cancellation resets history and touch or dragging never starts a forecast', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const events = [];
    hasta.track(h.element()).when({ type: 'intersects', withinMs: 120 }, (e) => events.push(e));
    h.pointer(1000, 0, 110, { pointerType: 'touch' });
    h.pointer(1020, 20, 110, { pointerType: 'touch' });
    h.frame();
    h.pointer(1030, 0, 110, { buttons: 1 });
    h.pointer(1050, 20, 110, { buttons: 1 });
    h.frame();
    const ignored = events.length;
    h.pointer(1060, 0);
    h.pointer(1080, 20);
    h.frame();
    h.pointer(1081, 20, 110, { type: 'pointercancel' });
    const cancelled = events[0].signal.aborted;
    h.pointer(1090, 25);
    h.frame();
    hasta.destroy();

    return { ignored, cancelled, count: events.length };
  });

  expect(result).toEqual({ ignored: 0, cancelled: true, count: 1 });
});

test('custom conditions and rejected callbacks do not stop other subscriptions', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.harness;
    const errors = [];
    const hasta = h.createHasta({ onError: (error) => errors.push(error.message) });
    const target = hasta.track(h.element());
    const fired = [];
    target.when(
      ({ intersection }) => intersection !== null && intersection.etaMs < 100,
      async () => {
        fired.push('custom');
        throw new Error('expected failure');
      },
    );
    target.when({ type: 'intersects', withinMs: 120 }, () => fired.push('builtin'));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    await Promise.resolve();
    await Promise.resolve();
    hasta.destroy();

    return { errors, fired };
  });

  expect(result).toEqual({ errors: ['expected failure'], fired: ['custom', 'builtin'] });
});

test('rejects invalid configuration and targets from a different document', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const caught = [];

    for (const options of [
      { horizonMs: 0 },
      { maxSampleAgeMs: Infinity },
      { bounds: 'invalidated' },
    ]) {
      try {
        h.createHasta(options);
      } catch {
        caught.push(true);
      }
    }

    const hasta = h.createHasta();
    const target = hasta.track(h.element());

    for (const condition of [
      { type: 'intersects', withinMs: -1 },
      { type: 'intersects', withinMs: 10, marginPx: -1 },
    ]) {
      try {
        target.when(condition, () => {});
      } catch {
        caught.push(true);
      }
    }

    try {
      hasta.track(document.implementation.createHTMLDocument().body);
    } catch {
      caught.push(true);
    }

    hasta.destroy();

    try {
      hasta.track(h.element());
    } catch {
      caught.push(true);
    }

    return caught.length;
  });

  expect(result).toBe(7);
});

test('native mouse events trigger callbacks using the real browser scheduler', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.ready);
  await page.evaluate(() => {
    const h = window.harness;
    window.nativeHits = 0;
    window.nativeHasta = h.createHasta({ horizonMs: 500, maxSampleAgeMs: 500 });
    window.nativeHasta
      .track(h.element({ x: 300, y: 100, width: 200, height: 100 }))
      .when({ type: 'intersects', withinMs: 500 }, () => window.nativeHits++);
  });
  await page.mouse.move(20, 150);
  await page.waitForTimeout(20);
  await page.mouse.move(100, 150);
  await expect.poll(() => page.evaluate(() => window.nativeHits)).toBe(1);
  await page.evaluate(() => window.nativeHasta.destroy());
});
