import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('createHasta rejects non-plain options including arrays', async ({ page }) => {
  const results = await page.evaluate(async () => {
    const { createHasta } = await import('/dist/index.js');

    return [[], null, 'bad', 123].map((invalid) => {
      try {
        createHasta(invalid);

        return 'no-throw';
      } catch (error) {
        return error instanceof TypeError ? error.name : 'other';
      }
    });
  });

  expect(results).toEqual(['TypeError', 'TypeError', 'TypeError', 'TypeError']);
});

test('throwing predicate reports error and aborts signal with reason error', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createHasta } = await import('/dist/index.js');

    let mockNow = performance.now() + 1000;
    const queued = [];
    Object.defineProperty(window.performance, 'now', {
      configurable: true,
      value: () => mockNow,
    });
    window.requestAnimationFrame = (callback) => {
      const id = queued.length + 1;
      queued.push({ id, callback });

      return id;
    };

    window.cancelAnimationFrame = () => {};

    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:200px;top:200px;width:100px;height:100px;';
    document.body.append(box);

    const emitMove = (x, y) => {
      const event = new PointerEvent('pointermove', {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
      });

      Object.defineProperty(event, 'timeStamp', { configurable: true, value: mockNow });

      document.dispatchEvent(event);
    };

    const flushFrame = () => {
      const pending = queued.splice(0);

      for (const entry of pending) {
        entry.callback(mockNow);
      }
    };

    const errors = [];
    const signals = [];
    let shouldThrow = false;

    const hasta = createHasta({
      onError(cause) {
        errors.push(cause instanceof Error ? cause.message : String(cause));
      },
    });

    const target = hasta.track(box);
    target.when(
      () => {
        if (shouldThrow) {
          throw new Error('predicate failed');
        }

        return true;
      },
      (event) => {
        signals.push(event.signal);
      },
    );

    flushFrame();
    emitMove(50, 250);
    mockNow += 16;
    emitMove(80, 250);
    mockNow += 16;
    emitMove(110, 250);
    flushFrame();

    const abortedBefore = signals[0]?.aborted;
    shouldThrow = true;
    mockNow += 16;
    emitMove(140, 250);
    flushFrame();

    const snapshot = {
      fireCount: signals.length,
      abortedBefore,
      abortedAfter: signals[0]?.aborted,
      reasonAfter: signals[0]?.reason,
      errors,
    };

    hasta.destroy();

    return snapshot;
  });

  expect(result).toEqual({
    fireCount: 1,
    abortedBefore: false,
    abortedAfter: true,
    reasonAfter: 'error',
    errors: ['predicate failed'],
  });
});

test('synchronous nested frame without pause preserves evaluatingDepth and queued samples', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createHasta } = await import('/dist/index.js');

    let mockNow = performance.now() + 1000;
    const queued = [];
    Object.defineProperty(window.performance, 'now', {
      configurable: true,
      value: () => mockNow,
    });
    window.requestAnimationFrame = (callback) => {
      const id = queued.length + 1;
      queued.push({ id, callback });

      return id;
    };

    window.cancelAnimationFrame = () => {};

    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:220px;top:220px;width:80px;height:80px;';
    document.body.append(box);

    const emitMove = (x, y) => {
      const event = new PointerEvent('pointermove', {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
      });

      Object.defineProperty(event, 'timeStamp', { configurable: true, value: mockNow });

      document.dispatchEvent(event);
    };

    const flushOne = () => {
      const entry = queued.shift();

      if (entry) {
        entry.callback(mockNow);
      }
    };

    const hasta = createHasta();
    const anchorXs = [];
    let nestedTriggered = false;

    const target = hasta.track(box);
    target.when(
      (context) => {
        anchorXs.push(Math.round(context.forecast.points[0].x));

        if (!nestedTriggered && anchorXs.length === 1) {
          nestedTriggered = true;
          mockNow += 8;
          emitMove(180, 260);
          flushOne();
        }

        return false;
      },
      () => {},
    );

    flushOne();
    emitMove(40, 260);
    mockNow += 16;
    emitMove(80, 260);
    flushOne();
    mockNow += 16;
    flushOne();
    hasta.destroy();

    return { nestedTriggered, count: anchorXs.length, lastAnchorX: anchorXs.at(-1) };
  });

  expect(result.nestedTriggered).toBe(true);
  expect(result.count).toBeGreaterThanOrEqual(2);
  expect(result.lastAnchorX).toBeGreaterThan(150);
});

test('rejected pointer switch does not unbind the active pointerId', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createHasta } = await import('/dist/index.js');

    let mockNow = performance.now() + 1000;
    const queued = [];
    Object.defineProperty(window.performance, 'now', {
      configurable: true,
      value: () => mockNow,
    });
    window.requestAnimationFrame = (callback) => {
      const id = queued.length + 1;
      queued.push({ id, callback });

      return id;
    };

    window.cancelAnimationFrame = () => {};

    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:220px;top:180px;width:100px;height:100px;';
    document.body.append(box);

    const dispatch = (pointerId, pointerType, x, y, stamp = mockNow) => {
      const event = new PointerEvent('pointermove', {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId,
        pointerType,
      });

      Object.defineProperty(event, 'timeStamp', { configurable: true, value: stamp });

      document.dispatchEvent(event);
    };

    const flushFrame = () => {
      const pending = queued.splice(0);

      for (const entry of pending) {
        entry.callback(mockNow);
      }
    };

    let hits = 0;
    const hasta = createHasta();
    hasta.track(box).when(
      { type: 'intersects', withinMs: 300, includeCurrent: true },
      () => {
        hits++;
      },
      { once: true },
    );

    flushFrame();
    dispatch(1, 'mouse', 40, 230);
    mockNow += 16;
    dispatch(1, 'mouse', 80, 230);

    // Rejected pointerType from pointerId 2 must not hijack active pointerId 1
    dispatch(2, 'touch', 900, 900);
    // Stale older timestamp from pointerId 2 must also leave pointerId 1 active
    dispatch(2, 'mouse', 900, 900, mockNow - 10);

    mockNow += 16;
    dispatch(1, 'mouse', 140, 230);
    flushFrame();
    hasta.destroy();

    return hits;
  });

  expect(result).toBe(1);
});

test('untracking a shadow DOM target preserves cached bounds on remaining targets and detaches scroll listeners', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createHasta } = await import('/dist/index.js');

    let mockNow = performance.now() + 1000;
    const queued = [];
    Object.defineProperty(window.performance, 'now', {
      configurable: true,
      value: () => mockNow,
    });
    window.requestAnimationFrame = (callback) => {
      const id = queued.length + 1;
      queued.push({ id, callback });

      return id;
    };

    window.cancelAnimationFrame = () => {};

    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowBox = document.createElement('div');
    shadowBox.style.cssText = 'position:fixed;left:40px;top:40px;width:60px;height:60px;';
    shadow.append(shadowBox);

    const lightBox = document.createElement('div');
    lightBox.style.cssText = 'position:fixed;left:300px;top:300px;width:80px;height:80px;';
    document.body.append(host, lightBox);

    let shadowScrollListeners = 0;
    const originalAdd = shadow.addEventListener.bind(shadow);
    const originalRemove = shadow.removeEventListener.bind(shadow);
    shadow.addEventListener = (...args) => {
      if (args[0] === 'scroll') {
        shadowScrollListeners++;
      }

      return originalAdd(...args);
    };

    shadow.removeEventListener = (...args) => {
      if (args[0] === 'scroll') {
        shadowScrollListeners--;
      }

      return originalRemove(...args);
    };

    let lightMeasurements = 0;
    const origRect = lightBox.getBoundingClientRect.bind(lightBox);
    lightBox.getBoundingClientRect = () => {
      lightMeasurements++;

      return origRect();
    };

    const flushFrame = () => {
      const pending = queued.splice(0);

      for (const entry of pending) {
        entry.callback(mockNow);
      }
    };

    const hasta = createHasta({ bounds: 'cached' });
    const t1 = hasta.track(shadowBox);
    const t2 = hasta.track(lightBox);
    flushFrame();

    const afterInit = { lightMeasurements, shadowScrollListeners };
    lightMeasurements = 0;

    t1.untrack();
    mockNow += 16;
    flushFrame();
    shadow.dispatchEvent(new Event('scroll'));
    mockNow += 16;
    flushFrame();

    const cachedBounds = t2.getBounds();
    hasta.destroy();

    return {
      afterInit,
      afterUntrackMeasurements: lightMeasurements,
      remainingShadowScrollListeners: shadowScrollListeners,
      preservedBoundsWidth: cachedBounds ? cachedBounds.rect.maxX - cachedBounds.rect.minX : null,
    };
  });

  expect(result).toEqual({
    afterInit: { lightMeasurements: 1, shadowScrollListeners: 1 },
    afterUntrackMeasurements: 0,
    remainingShadowScrollListeners: 0,
    preservedBoundsWidth: 80,
  });
});

test('controller predicate swap avoids DOM remeasurement and idle rAF scheduling', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createHastaController } = await import('/dist/vanilla/index.js');

    let mockNow = performance.now() + 1000;
    const queued = [];
    let rafCount = 0;
    Object.defineProperty(window.performance, 'now', {
      configurable: true,
      value: () => mockNow,
    });
    window.requestAnimationFrame = (callback) => {
      rafCount++;
      const id = queued.length + 1;
      queued.push({ id, callback });

      return id;
    };

    window.cancelAnimationFrame = () => {};

    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;left:220px;top:220px;width:80px;height:80px;';
    document.body.append(box);

    let measurements = 0;
    const origRect = box.getBoundingClientRect.bind(box);
    box.getBoundingClientRect = () => {
      measurements++;

      return origRect();
    };

    const flushFrame = () => {
      const pending = queued.splice(0);

      for (const entry of pending) {
        entry.callback(mockNow);
      }
    };

    const controller = createHastaController({ bounds: 'cached' });
    controller.connect();
    const hits = [];

    const binding = controller.target({
      when: () => false,
      onPredict() {},
    });

    binding.ref(box);
    flushFrame();

    // Idle predicate update must neither re-measure geometry nor schedule a frame
    measurements = 0;
    rafCount = 0;
    binding.update({
      when: () => false,
      onPredict() {},
    });
    const idleRafCount = rafCount;
    const idleMeasurements = measurements;

    // Active pointer movement lets predicate replacement schedule evaluation without remeasurement
    const sendMove = (x, y) => {
      const event = new PointerEvent('pointermove', {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
      });

      Object.defineProperty(event, 'timeStamp', { configurable: true, value: mockNow });

      document.dispatchEvent(event);
    };

    sendMove(100, 260);
    mockNow += 16;
    sendMove(140, 260);
    flushFrame();

    let p3Calls = 0;
    measurements = 0;
    binding.update({
      when: () => {
        p3Calls++;

        return true;
      },
      onPredict() {
        hits.push('p3');
      },
    });
    mockNow += 16;
    flushFrame();
    const evalOnExistingInput = p3Calls;
    mockNow += 16;
    sendMove(180, 260);
    flushFrame();
    const activeMeasurements = measurements;

    controller.destroy();

    return {
      idleRafCount,
      idleMeasurements,
      evalOnExistingInput,
      activeMeasurements,
      hits,
    };
  });

  expect(result).toEqual({
    idleRafCount: 0,
    idleMeasurements: 0,
    evalOnExistingInput: 1,
    activeMeasurements: 0,
    hits: ['p3'],
  });
});

test('sparse fast-path evaluates few candidates across many targets and shrinks extents after once', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createHasta } = await import('/dist/index.js');

    let mockNow = performance.now() + 1000;
    const queued = [];
    Object.defineProperty(window.performance, 'now', {
      configurable: true,
      value: () => mockNow,
    });
    window.requestAnimationFrame = (callback) => {
      const id = queued.length + 1;
      queued.push({ id, callback });

      return id;
    };

    window.cancelAnimationFrame = () => {};

    const flushFrame = () => {
      const pending = queued.splice(0);

      for (const entry of pending) {
        entry.callback(mockNow);
      }
    };

    const sendMove = (x, y) => {
      const event = new PointerEvent('pointermove', {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
      });

      Object.defineProperty(event, 'timeStamp', { configurable: true, value: mockNow });

      document.dispatchEvent(event);
    };

    const hasta = createHasta({ bounds: 'cached', horizonMs: 120 });
    const fired = [];

    for (let index = 0; index < 40; index++) {
      const el = document.createElement('button');
      el.style.cssText =
        index === 0
          ? 'position:fixed;left:260px;top:60px;width:60px;height:40px;'
          : `position:fixed;left:260px;top:${200 + index * 45}px;width:60px;height:30px;`;
      document.body.append(el);

      const handle = hasta.track(el);

      if (index === 0) {
        handle.when(
          { type: 'intersects', withinMs: 400, marginPx: 50, includeCurrent: true },
          () => {
            fired.push(0);
          },
          { once: true },
        );
      } else {
        handle.when(
          { type: 'intersects', withinMs: 120, marginPx: 0 },
          () => {
            fired.push(index);
          },
          { once: true },
        );
      }
    }

    flushFrame();

    // Sweep toward target 0 using long lookahead
    sendMove(100, 80);
    mockNow += 16;
    sendMove(140, 80);
    flushFrame();

    // Move away so once:true settles and exhausts target 0 extents
    mockNow += 16;
    sendMove(100, 215);
    flushFrame();

    // Sweep horizontally toward target 1 only
    mockNow += 16;
    sendMove(180, 250);
    mockNow += 16;
    sendMove(230, 250);
    flushFrame();

    hasta.destroy();

    return fired;
  });

  expect(result).toEqual([0, 1]);
});

test('debug overlay reuses persistent motion layer node across frames', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createHasta } = await import('/dist/index.js');

    let mockNow = performance.now() + 1000;
    const queued = [];
    Object.defineProperty(window.performance, 'now', {
      configurable: true,
      value: () => mockNow,
    });
    window.requestAnimationFrame = (callback) => {
      const id = queued.length + 1;
      queued.push({ id, callback });

      return id;
    };

    window.cancelAnimationFrame = () => {};

    const box = document.createElement('button');
    box.dataset.hastaLabel = 'Alpha';
    box.style.cssText = 'position:fixed;left:320px;top:240px;width:90px;height:40px;';
    document.body.append(box);

    const flushFrame = () => {
      const pending = queued.splice(0);

      for (const entry of pending) {
        entry.callback(mockNow);
      }
    };

    const sendMove = (x, y) => {
      const event = new PointerEvent('pointermove', {
        bubbles: true,
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
      });

      Object.defineProperty(event, 'timeStamp', { configurable: true, value: mockNow });

      document.dispatchEvent(event);
    };

    let boxReads = 0;
    const nativeRect = box.getBoundingClientRect.bind(box);

    box.getBoundingClientRect = () => {
      boxReads++;

      return nativeRect();
    };

    const hasta = createHasta({ bounds: 'cached', debug: { samples: true } });
    hasta.track(box).when({ type: 'intersects', withinMs: 250 }, () => {});
    flushFrame();

    const host = document.querySelector('[data-hasta-debug]');
    const shadow = host?.shadowRoot;
    const motionFirst = shadow?.querySelector('[data-hasta-layer="motion"]') ?? null;

    sendMove(80, 260);
    mockNow += 16;
    sendMove(140, 260);
    flushFrame();

    const motionSecond = shadow?.querySelector('[data-hasta-layer="motion"]') ?? null;

    mockNow += 16;
    sendMove(200, 260);
    flushFrame();

    // Reset after status transition mutation drains so steady-state debug frames avoid invalidating geometry
    boxReads = 0;
    mockNow += 16;
    sendMove(240, 260);
    flushFrame();

    const steadyStateDebugReads = boxReads;
    const motionThird = shadow?.querySelector('[data-hasta-layer="motion"]') ?? null;
    const hasTrajectory = shadow?.querySelector('[data-hasta-trajectory]') !== null;
    const hasSamples = shadow?.querySelector('[data-hasta-samples]') !== null;
    const labelText = shadow?.querySelector('[data-hasta-target-label]')?.textContent ?? '';

    hasta.setDebug(false);
    const removedHost = document.querySelector('[data-hasta-debug]') === null;
    hasta.destroy();

    return {
      hasMotion: motionFirst !== null,
      sameNodeAcrossFrames: motionFirst === motionSecond && motionSecond === motionThird,
      steadyStateDebugReads,
      hasTrajectory,
      hasSamples,
      labelContainsAlpha: labelText.includes('Alpha'),
      removedHost,
    };
  });

  expect(result).toEqual({
    hasMotion: true,
    sameNodeAcrossFrames: true,
    steadyStateDebugReads: 0,
    hasTrajectory: true,
    hasSamples: true,
    labelContainsAlpha: true,
    removedHost: true,
  });
});
