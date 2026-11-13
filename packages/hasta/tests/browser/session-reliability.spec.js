import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

for (const horizonMs of [30, 120, 400]) {
  for (const withinMs of [60, 160, 800]) {
    test(`a ${withinMs}ms rule has its own horizon beside a ${horizonMs}ms predicate`, async ({
      page,
    }) => {
      const result = await page.evaluate(
        ({ horizonMs, withinMs }) => {
          const h = window.harness;
          const engine = h.createHasta({ horizonMs });
          const target = engine.track(h.element());
          const hits = [];
          const forecasts = [];
          target.when({ type: 'intersects', withinMs }, (event) =>
            hits.push({ eta: event.etaMs, horizon: event.forecast.points.at(-1).offsetMs }),
          );
          target.when(
            (context) => {
              forecasts.push(context.forecast.points.at(-1).offsetMs);

              return false;
            },
            () => {},
          );
          h.pointer(1000, 0);
          h.pointer(1020, 20);
          h.frame();
          engine.destroy();

          return { hits, forecasts };
        },
        { horizonMs, withinMs },
      );

      expect(result).toEqual({
        hits: withinMs >= 80 ? [{ eta: 80, horizon: withinMs }] : [],
        forecasts: [horizonMs],
      });
    });
  }
}

test('an expired session cannot overwrite fresher input dispatched by its abort listener', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta({ debug: true });
    const signals = [];
    engine
      .track(h.element({ width: 100 }))
      .when({ type: 'intersects', withinMs: 120, includeCurrent: true }, ({ signal }) => {
        signals.push(signal);

        if (signals.length === 1) {
          signal.addEventListener(
            'abort',
            () => {
              h.pointer(1400, 150);
              h.pointer(1410, 151);
            },
            { once: true },
          );
        }
      });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.pointer(1200, 50);
    h.frame(1410);
    const snapshot = engine.getDebugSnapshot();

    const state = {
      count: signals.length,
      aborted: signals.map((signal) => signal.aborted),
      pointerTime: snapshot.pointer.timeStamp,
      status: snapshot.status,
    };

    engine.destroy();

    return state;
  });

  expect(result).toEqual({
    count: 2,
    aborted: [true, false],
    pointerTime: 1410,
    status: 'tracking',
  });
});

test('pointer replacement cannot reclaim an ID after an abort handler starts a newer session', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const signals = [];
    engine
      .track(h.element({ width: 100 }))
      .when({ type: 'intersects', withinMs: 120, includeCurrent: true }, ({ signal }) => {
        signals.push(signal);

        if (signals.length === 1) {
          signal.addEventListener(
            'abort',
            () => {
              h.pointer(1200, 150, 110, { pointerId: 3 });
              h.pointer(1210, 151, 110, { pointerId: 3 });
            },
            { once: true },
          );
        }
      });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.pointer(1100, 50, 110, { pointerId: 2 });
    h.frame(1210);
    h.pointer(1220, 152, 110, { pointerId: 3 });
    h.frame();
    const state = { count: signals.length, aborted: signals.map((signal) => signal.aborted) };
    engine.destroy();

    return state;
  });

  expect(result).toEqual({ count: 2, aborted: [true, false] });
});

for (const marginPx of [0, 40]) {
  test(`all geometrically intersected targets fire independently with ${marginPx}px margin`, async ({
    page,
  }) => {
    const result = await page.evaluate((marginPx) => {
      const h = window.harness;
      const engine = h.createHasta();
      const hits = [];

      for (const x of [100, 150, 220]) {
        engine
          .track(h.element({ x }))
          .when({ type: 'intersects', withinMs: 160, marginPx }, (event) =>
            hits.push([event.rect.minX, event.etaMs]),
          );
      }

      h.pointer(1000, 0);
      h.pointer(1020, 20);
      h.frame();
      engine.destroy();

      return hits;
    }, marginPx);

    expect(result).toEqual(
      marginPx === 0
        ? [
            [100, 80],
            [150, 130],
          ]
        : [
            [100, 40],
            [150, 90],
            [220, 160],
          ],
    );
  });
}

for (const operation of ['pause', 'disconnect', 'options']) {
  test(`twenty controller ${operation} cycles release old signals and accept fresh input`, async ({
    page,
  }) => {
    const result = await page.evaluate(async (operation) => {
      const { createHastaController } = await import('/dist/vanilla/index.js');
      const h = window.harness;
      const controller = createHastaController({ debug: true });
      const signals = [];
      const states = [];
      controller
        .target({
          when: { type: 'intersects', withinMs: 120, includeCurrent: true },
          onPredict: (event) => signals.push(event.signal),
        })
        .ref(h.element({ width: 100 }));
      controller.connect();

      for (let cycle = 0; cycle < 20; cycle++) {
        const base = 1000 + cycle * 200;
        h.pointer(base, 140);
        h.pointer(base + 10, 141);
        h.frame();
        const before = signals.length;

        if (operation === 'pause') {
          controller.pause();
          controller.resume();
        }

        if (operation === 'disconnect') {
          controller.disconnect();
          controller.connect();
        }

        if (operation === 'options') {
          controller.updateOptions({ debug: true, horizonMs: cycle % 2 === 0 ? 160 : 120 });
        }

        const aborted = signals.every((signal) => signal.aborted);
        h.pointer(base + 20, 145);
        h.frame();
        states.push({
          before,
          afterWarmup: signals.length,
          aborted,
          targets: controller.getDebugSnapshot().targets.length,
          frames: h.pendingFrames(),
        });
      }

      controller.destroy();

      return { states, frames: h.pendingFrames() };
    }, operation);

    expect(result.states).toEqual(
      Array.from({ length: 20 }, (_, index) => ({
        before: index + 1,
        afterWarmup: index + 1,
        aborted: true,
        targets: 1,
        frames: 1,
      })),
    );
    expect(result.frames).toBe(0);
  });
}
