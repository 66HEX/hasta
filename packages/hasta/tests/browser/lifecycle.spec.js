import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

test('blur, hidden state and document exit reset history while child transitions preserve it', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const element = h.element();
    const child = document.createElement('span');
    element.append(child);
    const events = [];
    hasta.track(element).when({ type: 'intersects', withinMs: 120 }, (event) => {
      events.push(event);
    });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.pointer(1021, 20, 110, { type: 'pointerout', target: element, relatedTarget: child });
    h.frame(1030);
    const childTransition = { count: events.length, aborted: events[0].signal.aborted };

    window.dispatchEvent(new Event('blur'));
    const blurred = events[0].signal.aborted;
    h.pointer(1040, 0);
    h.frame();
    const blurWarmup = events.length;
    h.pointer(1060, 20);
    h.frame();

    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    const hidden = events[1].signal.aborted;
    h.pointer(1080, 40);
    h.frame();
    const hiddenCount = events.length;
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
    h.pointer(1100, 0);
    h.frame();
    const visibleWarmup = events.length;
    h.pointer(1120, 20);
    h.frame();

    h.pointer(1121, 20, 110, { type: 'pointerout', target: element, relatedTarget: null });
    const exited = events[2].signal.aborted;
    h.pointer(1140, 0);
    h.frame();
    const exitWarmup = events.length;
    h.pointer(1160, 20);
    h.frame();
    hasta.destroy();

    return {
      childTransition,
      blurred,
      blurWarmup,
      hidden,
      hiddenCount,
      visibleWarmup,
      exited,
      exitWarmup,
      count: events.length,
    };
  });

  expect(result).toEqual({
    childTransition: { count: 1, aborted: false },
    blurred: true,
    blurWarmup: 1,
    hidden: true,
    hiddenCount: 2,
    visibleWarmup: 2,
    exited: true,
    exitWarmup: 3,
    count: 4,
  });
});

test('destroying an instance from a callback suppresses its remaining callback queue', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const fired = [];
    hasta.track(h.element()).when({ type: 'intersects', withinMs: 120 }, () => {
      fired.push('first');
      hasta.destroy();
    });
    hasta.track(h.element()).when({ type: 'intersects', withinMs: 120 }, () => {
      fired.push('second');
    });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.pointer(1030, 30);
    h.frame();

    return { fired, frames: h.pendingFrames() };
  });

  expect(result).toEqual({ fired: ['first'], frames: 0 });
});

test('an abort listener destroying the instance prevents later predicates from running', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    let aborts = 0;
    let predicateCalls = 0;
    let callbacks = 0;
    hasta.track(h.element()).when({ type: 'intersects', withinMs: 120 }, ({ signal }) => {
      signal.addEventListener(
        'abort',
        () => {
          aborts++;
          hasta.destroy();
        },
        { once: true },
      );
    });
    hasta.track(h.element()).when(
      () => {
        predicateCalls++;

        return true;
      },
      () => {
        callbacks++;
      },
    );
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const before = { predicateCalls, callbacks };
    h.pointer(1030, 10);
    h.frame();

    return { before, predicateCalls, callbacks, aborts, frames: h.pendingFrames() };
  });

  expect(result).toEqual({
    before: { predicateCalls: 1, callbacks: 1 },
    predicateCalls: 1,
    callbacks: 1,
    aborts: 1,
    frames: 0,
  });
});

test('an async condition is rejected without an unhandled Promise rejection', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.harness;
    const errors = [];
    const unhandled = [];
    window.addEventListener('unhandledrejection', (event) => {
      unhandled.push(String(event.reason));
    });

    const hasta = h.createHasta({
      onError: (error) => {
        errors.push(error.name);
      },
    });

    let callbacks = 0;
    hasta.track(h.element()).when(
      async () => {
        throw new Error('rejected condition');
      },
      () => {
        callbacks++;
      },
    );
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    hasta.destroy();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    return { errors, unhandled, callbacks };
  });

  expect(result).toEqual({ errors: ['TypeError'], unhandled: [], callbacks: 0 });
});

test('empty coalesced lists fall back to the event and duplicate or old times do not corrupt velocity', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    const hits = [];
    hasta.track(h.element()).when({ type: 'intersects', withinMs: 120 }, (event) => {
      hits.push({ etaMs: event.etaMs, origin: event.forecast.points[0].x });
    });
    h.pointer(1000, 0, 110, { coalesced: [] });
    h.frame();
    h.pointer(1020, 10, 110, { coalesced: [] });
    h.pointer(1020, 20, 110, { coalesced: [] });
    h.pointer(1020, 20, 110, { coalesced: [] });

    const stale = new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 900,
      clientY: 110,
    });

    Object.defineProperty(stale, 'timeStamp', { value: 1010 });
    document.dispatchEvent(stale);

    const future = new PointerEvent('pointermove', {
      bubbles: true,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 900,
      clientY: 110,
    });

    Object.defineProperty(future, 'timeStamp', { value: 2000 });
    document.dispatchEvent(future);
    h.frame();
    hasta.destroy();

    return hits;
  });

  expect(result).toEqual([{ etaMs: 80, origin: 20 }]);
});

test('ResizeObserver schedules an idle size measurement and disconnects at destroy', async ({
  page,
}) => {
  await page.evaluate(() => {
    const h = window.harness;
    window.sizeElement = h.element();
    window.sizeHasta = h.createHasta();
    window.sizeTarget = window.sizeHasta.track(window.sizeElement);
    h.frame();
  });
  // Let the real browser deliver the initial ResizeObserver notification
  await expect.poll(() => page.evaluate(() => window.harness.pendingFrames())).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.harness.frame(1010);
    window.sizeElement.style.width = '45px';
  });
  await expect.poll(() => page.evaluate(() => window.harness.pendingFrames())).toBeGreaterThan(0);

  const result = await page.evaluate(() => {
    window.harness.frame(1020);
    const bounds = window.sizeTarget.getBounds();
    window.sizeHasta.destroy();
    window.sizeElement.style.width = '70px';

    return bounds.rect.maxX - bounds.rect.minX;
  });

  expect(result).toBe(45);
  await page.waitForTimeout(50);
  expect(await page.evaluate(() => window.harness.pendingFrames())).toBe(0);
});

test('idle scrolling inside a shadow root schedules fresh viewport bounds', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
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
    root.append(container);
    const element = h.element({ x: 100, y: 60, parent: content });
    element.style.position = 'absolute';
    const hasta = h.createHasta();
    const target = hasta.track(element);
    h.frame();
    const before = target.getBounds().rect;
    container.scrollLeft = 40;
    container.scrollTop = 20;
    container.dispatchEvent(new Event('scroll', { composed: false }));
    const scheduled = h.pendingFrames();
    h.frame(1010);
    const after = target.getBounds().rect;
    hasta.destroy();

    return { before, after, scheduled };
  });

  expect(result.before.minX).toBe(150);
  expect(result.before.minY).toBe(90);
  expect(result.after.minX).toBe(110);
  expect(result.after.minY).toBe(70);
  expect(result.scheduled).toBe(1);
});
