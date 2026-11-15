import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

for (const sharedFirst of [true, false]) {
  test(`shared and local misses preserve evidence order with sharedFirst=${sharedFirst}`, async ({
    page,
  }) => {
    const result = await page.evaluate((firstShared) => {
      const h = window.harness;
      const engine = h.createHasta();
      const element = h.element({ x: 900 });
      const target = engine.track(element);
      const sentinel = engine.track(h.element({ x: 950 }));
      const calls = [];
      target.when({ type: 'intersects', withinMs: 120 }, (event) => calls.push(event.evaluatedAt));

      let remove = firstShared
        ? null
        : sentinel.when(
            () => false,
            () => {},
          );

      h.pointer(1000, 0);
      h.pointer(1020, 20);
      h.frame();

      if (firstShared) {
        remove = sentinel.when(
          () => false,
          () => {},
        );
      } else {
        remove();
      }

      h.pointer(1040, 40);
      h.frame();
      remove?.();
      element.style.left = '100px';
      h.frame(1050);
      const withoutInput = calls.length;
      h.pointer(1060, 60);
      h.frame();
      engine.destroy();

      return { withoutInput, calls };
    }, sharedFirst);

    expect(result).toEqual({ withoutInput: 0, calls: [1060] });
  });
}

test('a newly registered rule does not inherit a previous shared miss', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element({ x: 900 });
    const target = engine.track(element);
    const calls = [];
    target.when({ type: 'intersects', withinMs: 120 }, () => calls.push('old'));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    target.when({ type: 'intersects', withinMs: 120 }, (event) => calls.push(event.evaluatedAt));
    element.style.left = '100px';
    h.frame(1030);
    engine.destroy();

    return calls;
  });

  expect(result).toEqual([1030]);
});

test('offscreen forecasts still fire and active signals abort after reversal', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const target = engine.track(h.element({ x: 100, y: 1000 }));
    const events = [];
    target.when({ type: 'intersects', withinMs: 120 }, (event) => events.push(event));
    h.pointer(1000, 105, 500);
    h.pointer(1020, 105, 600);
    h.frame();
    const predicted = events.map((event) => ({ time: event.evaluatedAt, eta: event.etaMs }));
    h.pointer(1040, 105, 200);
    h.frame();
    h.pointer(1060, 105, 0);
    h.frame();
    const aborted = events.map((event) => event.signal.aborted);
    engine.destroy();

    return { predicted, aborted };
  });

  expect(result).toEqual({ predicted: [{ time: 1020, eta: 80 }], aborted: [true] });
});

test('offscreen predicates run when the spatial query is empty', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    let evaluations = 0;
    let calls = 0;
    engine.track(h.element({ y: 1000 })).when(
      () => {
        evaluations++;

        return true;
      },
      () => {
        calls++;
      },
    );
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.frame(1030);
    engine.destroy();

    return { evaluations, calls };
  });

  expect(result).toEqual({ evaluations: 2, calls: 1 });
});

test('an outer local miss can follow a nested shared miss with newer pointer evidence', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const first = engine.track(h.element({ x: 950 }));
    const element = h.element({ x: 900 });
    const target = engine.track(element);
    const calls = [];

    const remove = first.when(
      () => {
        remove();
        h.pointer(1040, 40);
        h.frame();

        return false;
      },
      () => {},
    );

    target.when({ type: 'intersects', withinMs: 120 }, (event) => calls.push(event.evaluatedAt));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    element.style.left = '100px';
    h.frame(1050);
    engine.destroy();

    return calls;
  });

  expect(result).toEqual([1050]);
});
