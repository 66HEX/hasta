import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

test('a cold miss cannot turn into fresh predictive evidence when only geometry changes', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element({ x: 900 });
    const calls = [];
    engine
      .track(element)
      .when({ type: 'intersects', withinMs: 120 }, (event) => calls.push(event.evaluatedAt));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    element.style.left = '100px';
    h.frame(1030);
    const withoutInput = calls.length;
    h.pointer(1036, 36);
    h.frame();
    engine.destroy();

    return { withoutInput, calls };
  });

  expect(result).toEqual({ withoutInput: 0, calls: [1036] });
});

test('a missed target resets pending stabilization before its next approach', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element();
    const calls = [];
    engine
      .track(element)
      .when({ type: 'intersects', withinMs: 120 }, (event) => calls.push(event.evaluatedAt), {
        stableForMs: 40,
      });

    for (const time of [1000, 1020, 1040, 1060, 1080, 1100]) {
      const x = time - 1000;
      element.style.left = `${time === 1040 ? 900 : x + 60}px`;
      h.pointer(time, x);
      h.frame();
    }

    engine.destroy();

    return calls;
  });

  expect(result).toEqual([1100]);
});

test('a predicate can activate a later cold target in the same frame', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const first = engine.track(h.element());
    const later = engine.track(h.element({ x: 900 }));
    const calls = [];
    let added = false;
    first.when(
      () => {
        if (!added) {
          added = true;
          later.when(
            () => true,
            (event) => calls.push(event.evaluatedAt),
          );
        }

        return false;
      },
      () => {},
    );
    later.when({ type: 'intersects', withinMs: 120 }, () => calls.push('unexpected'));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    engine.destroy();

    return calls;
  });

  expect(result).toEqual([1020]);
});

test('a nested frame sees a later target before the outer frame records its miss', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const first = engine.track(h.element());
    const element = h.element({ x: 900 });
    const later = engine.track(element);
    const calls = [];
    let nested = false;
    first.when(
      () => {
        if (!nested) {
          nested = true;
          element.style.left = '100px';
          later.invalidate();
          h.frame(1021);
        }

        return false;
      },
      () => {},
    );
    later.when({ type: 'intersects', withinMs: 120 }, (event) => calls.push(event.evaluatedAt), {
      once: true,
    });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    engine.destroy();

    return calls;
  });

  expect(result).toEqual([1021]);
});

test('reset preserves the evidence consumed by a cold miss', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element({ x: 900 });
    const calls = [];
    engine
      .track(element)
      .when({ type: 'intersects', withinMs: 120 }, (event) => calls.push(event.evaluatedAt));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    engine.pause();
    engine.resume();
    element.style.left = '100px';
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.pointer(1040, 40);
    h.frame();
    engine.destroy();

    return calls;
  });

  expect(result).toEqual([1040]);
});

test('visibility changes inside measurement interrupt the active frame', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element();
    const measure = element.getBoundingClientRect.bind(element);
    const calls = [];
    engine.track(element).when({ type: 'intersects', withinMs: 120 }, () => calls.push('hit'));
    element.getBoundingClientRect = () => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));

      return measure();
    };

    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const pending = h.pendingFrames();
    engine.destroy();

    return { calls, pending };
  });

  expect(result).toEqual({ calls: [], pending: 0 });
});

test('a spent once rule still aborts on departure and keeps fresh tracked geometry', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element();
    const target = engine.track(element);
    const events = [];
    target.when(
      { type: 'intersects', withinMs: 120, includeCurrent: true },
      (event) => events.push(event),
      { once: true },
    );
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const entered = events.length;
    element.style.left = '900px';
    h.pointer(1040, 40);
    h.frame();
    const aborted = events[0].signal.aborted;
    element.style.left = '100px';
    h.pointer(1060, 60);
    h.frame();
    element.style.left = '150px';
    h.pointer(1080, 80);
    h.frame();
    const bounds = target.getBounds();
    engine.destroy();

    return {
      entered,
      aborted,
      calls: events.length,
      x: bounds.rect.minX,
      measuredAt: bounds.measuredAt,
    };
  });

  expect(result).toEqual({ entered: 1, aborted: true, calls: 1, x: 150, measuredAt: 1080 });
});

test('new rules retain prediction history after every earlier rule has been spent', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element();
    const target = engine.track(element);
    const calls = [];
    target.when(
      { type: 'intersects', withinMs: 120 },
      (event) => calls.push({ time: event.evaluatedAt, eta: event.etaMs }),
      { once: true },
    );
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    element.style.left = '900px';

    for (const time of [1040, 1060, 1080]) {
      h.pointer(time, time - 1000);
      h.frame();
    }

    element.style.left = '160px';
    target.when(
      { type: 'intersects', withinMs: 120 },
      (event) => calls.push({ time: event.evaluatedAt, eta: event.etaMs }),
      { once: true },
    );
    h.pointer(1100, 100);
    h.frame();
    engine.destroy();

    return calls;
  });

  expect(result.map((call) => call.time)).toEqual([1020, 1100]);
  expect(result[1].eta).toBeCloseTo(60, 8);
});
