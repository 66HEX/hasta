import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

test('tracks fractional, negative and transformed border boxes in viewport coordinates', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const element = h.element({ x: -15.25, y: 45.5, width: 40.25, height: 20.5 });
    Object.assign(element.style, {
      padding: '7.5px',
      border: '2px solid',
      boxSizing: 'content-box',
      transformOrigin: '0 0',
      transform: 'rotate(13deg) scale(1.25)',
    });
    const target = hasta.track(element);
    h.frame();
    const measured = target.getBounds().rect;
    const actual = element.getBoundingClientRect();
    hasta.destroy();

    return {
      measured,
      actual: { minX: actual.left, minY: actual.top, maxX: actual.right, maxY: actual.bottom },
    };
  });

  expect(result.measured).toEqual(result.actual);
  expect(result.measured.minX).toBeLessThan(0);
  expect(result.measured.maxX - result.measured.minX).toBeGreaterThan(40.25);
});

test('display none and zero area cancel a hit while restored geometry waits for fresh input', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const element = h.element();
    const target = hasta.track(element);
    const signals = [];
    target.when({ type: 'intersects', withinMs: 120 }, ({ signal }) => signals.push(signal));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    element.style.display = 'none';
    h.frame(1030);
    const hidden = { bounds: target.getBounds(), aborted: signals[0].aborted };
    element.style.display = '';
    h.frame(1040);
    const firstWait = signals.length;
    h.pointer(1041, 41);
    h.frame();
    element.style.width = '0px';
    h.frame(1050);
    const zero = { bounds: target.getBounds(), aborted: signals[1].aborted };
    element.style.width = '10px';
    h.frame(1060);
    const secondWait = signals.length;
    h.pointer(1061, 61);
    h.frame();
    const restored = { bounds: target.getBounds().rect, count: signals.length };
    hasta.destroy();

    return { hidden, zero, restored, firstWait, secondWait };
  });

  expect(result).toEqual({
    hidden: { bounds: null, aborted: true },
    zero: { bounds: null, aborted: true },
    restored: { bounds: { minX: 100, minY: 100, maxX: 110, maxY: 120 }, count: 3 },
    firstWait: 1,
    secondWait: 2,
  });
});

test('malformed DOMRect values park only their target and do not poison the spatial index', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const errors = [];
    const hasta = h.createHasta({ onError: (error) => errors.push(error.message) });
    const element = h.element();
    const target = hasta.track(element);
    const healthy = hasta.track(h.element());
    let calls = 0;
    healthy.when({ type: 'intersects', withinMs: 120 }, () => {
      calls++;
    });
    const nativeBounds = element.getBoundingClientRect.bind(element);
    const original = nativeBounds();

    const base = {
      left: original.left,
      top: original.top,
      right: original.right,
      bottom: original.bottom,
      width: original.width,
      height: original.height,
    };

    const invalid = [
      { width: NaN },
      { width: Infinity },
      { height: -Infinity },
      { left: NaN },
      { right: Infinity },
      { right: 99 },
      { bottom: 99 },
      { right: 100 },
      { bottom: 100 },
    ];

    h.pointer(1000, 0);
    h.pointer(1020, 20);
    const parked = [];

    for (const [i, patch] of invalid.entries()) {
      element.getBoundingClientRect = () => ({ ...base, ...patch });
      target.invalidate();
      h.frame(1020 + i);
      parked.push(target.getBounds() === null);
    }

    element.getBoundingClientRect = nativeBounds;
    target.invalidate();
    h.frame(1040);
    const recovered = target.getBounds().rect;
    hasta.destroy();

    return { parked, errors, calls, recovered };
  });

  expect(result).toEqual({
    parked: Array.from({ length: 9 }, () => true),
    errors: [],
    calls: 1,
    recovered: { minX: 100, minY: 100, maxX: 110, maxY: 120 },
  });
});

test('adopting a target into another document cancels it and restoring ownership reactivates it', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    const foreign = iframe.contentDocument;
    const hasta = h.createHasta();
    const element = h.element();
    const signals = [];
    const target = hasta.track(element);
    target.when({ type: 'intersects', withinMs: 120 }, ({ signal }) => signals.push(signal));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    foreign.body.append(element);
    const immediate = target.getBounds();
    h.frame(1030);

    const foreignState = {
      count: signals.length,
      aborted: signals[0].aborted,
      bounds: target.getBounds(),
    };

    document.body.append(element);
    h.frame(1040);
    const waiting = signals.length;
    h.pointer(1041, 41);
    h.frame();
    const restored = { count: signals.length, x: target.getBounds().rect.minX };
    hasta.destroy();
    iframe.remove();

    return { immediate, foreignState, restored, waiting };
  });

  expect(result).toEqual({
    immediate: null,
    foreignState: { count: 1, aborted: true, bounds: null },
    restored: { count: 2, x: 100 },
    waiting: 1,
  });
});

test('an explicit iframe document uses its own coordinates and does not consume parent pointer events', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, {
      position: 'absolute',
      left: '250px',
      top: '200px',
      width: '400px',
      height: '300px',
    });
    document.body.append(iframe);
    const child = iframe.contentWindow;
    const childDocument = child.document;
    child.requestAnimationFrame = window.requestAnimationFrame;
    child.cancelAnimationFrame = window.cancelAnimationFrame;
    Object.defineProperty(child.performance, 'now', { configurable: true, value: () => h.now() });
    const element = childDocument.createElement('div');
    Object.assign(element.style, {
      position: 'absolute',
      left: '100px',
      top: '100px',
      width: '10px',
      height: '20px',
    });
    childDocument.body.append(element);
    const hasta = h.createHasta({ document: childDocument });
    const hits = [];
    const target = hasta.track(element);
    target.when({ type: 'intersects', withinMs: 120 }, (event) =>
      hits.push({ eta: event.etaMs, rect: event.rect }),
    );
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const parentCount = hits.length;
    h.pointer(1030, 0, 110, { target: childDocument });
    h.pointer(1050, 20, 110, { target: childDocument });
    h.frame();
    hasta.destroy();
    iframe.remove();

    return { parentCount, hits, frames: h.pendingFrames() };
  });

  expect(result).toEqual({
    parentCount: 0,
    hits: [{ eta: 80, rect: { minX: 100, minY: 100, maxX: 110, maxY: 120 } }],
    frames: 0,
  });
});

test('closed nested shadow roots wake idle bounds and release scroll listeners after untrack', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const outerHost = document.createElement('div');
    document.body.append(outerHost);
    const outer = outerHost.attachShadow({ mode: 'closed' });
    const innerHost = document.createElement('div');
    outer.append(innerHost);
    const inner = innerHost.attachShadow({ mode: 'closed' });
    const scroller = document.createElement('div');
    Object.assign(scroller.style, {
      position: 'absolute',
      left: '50px',
      top: '30px',
      width: '200px',
      height: '100px',
      overflow: 'auto',
    });
    const content = document.createElement('div');
    Object.assign(content.style, { position: 'relative', width: '600px', height: '400px' });
    inner.append(scroller);
    scroller.append(content);
    const element = h.element({ x: 100, y: 60, parent: content });
    element.style.position = 'absolute';
    const hasta = h.createHasta();
    const target = hasta.track(element);
    hasta.track(h.element());
    h.frame();
    const before = target.getBounds().rect;
    scroller.scrollLeft = 40;
    scroller.dispatchEvent(new Event('scroll', { composed: false }));
    const scheduled = h.pendingFrames();
    h.frame(1010);
    const after = target.getBounds().rect;
    target.untrack();
    h.frame(1020);
    scroller.dispatchEvent(new Event('scroll', { composed: false }));
    outer.dispatchEvent(new Event('scroll', { composed: false }));
    const afterUntrack = h.pendingFrames();
    hasta.destroy();

    return { before, after, scheduled, afterUntrack };
  });

  expect(result.before).toEqual({ minX: 150, minY: 90, maxX: 160, maxY: 110 });
  expect(result.after).toEqual({ minX: 110, minY: 90, maxX: 120, maxY: 110 });
  expect(result.scheduled).toBe(1);
  expect(result.afterUntrack).toBe(0);
});

test('missing ResizeObserver still permits tracking and explicit idle invalidation', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const nativeObserver = window.ResizeObserver;
    window.ResizeObserver = undefined;

    try {
      const hasta = h.createHasta();
      const element = h.element();
      const target = hasta.track(element);
      h.frame();
      const before = target.getBounds().rect;
      element.style.width = '75px';
      target.invalidate();
      h.frame(1010);
      const after = target.getBounds().rect;
      hasta.destroy();

      return { before, after, frames: h.pendingFrames() };
    } finally {
      window.ResizeObserver = nativeObserver;
    }
  });

  expect(result).toEqual({
    before: { minX: 100, minY: 100, maxX: 110, maxY: 120 },
    after: { minX: 100, minY: 100, maxX: 175, maxY: 120 },
    frames: 0,
  });
});
