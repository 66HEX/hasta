import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

for (const stableForMs of [0, 30]) {
  test(`silence cannot introduce a new prediction episode with ${stableForMs} ms stability`, async ({
    page,
  }) => {
    const result = await page.evaluate((stableForMs) => {
      const h = window.harness;
      const engine = h.createHasta();
      const element = h.element({ x: 240, width: 20 });
      const calls = [];
      engine
        .track(element)
        .when({ type: 'intersects', withinMs: 120 }, (event) => calls.push(event.evaluatedAt), {
          stableForMs,
        });

      for (let time = 0; time <= 100; time++) {
        h.pointer(1000 + time, time);
      }

      for (const age of [0, 16, 32, 48, 64, 96, 100]) {
        h.frame(1100 + age);
      }

      const pending = h.pendingFrames();
      engine.destroy();

      return { calls, pending };
    }, stableForMs);

    expect(result).toEqual({ calls: [], pending: 0 });
  });
}

test('low-rate evidence preserves stability across idle frames and confirms on the next sample', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const events = [];
    engine
      .track(h.element({ x: 180, width: 20 }))
      .when({ type: 'intersects', withinMs: 120 }, (event) => events.push(event.evaluatedAt), {
        stableForMs: 30,
      });
    h.pointer(1060, 60);
    h.pointer(1100, 100);
    h.frame();
    h.frame(1116);
    h.frame(1132);
    const before = [...events];
    h.pointer(1140, 140);
    h.frame();
    engine.destroy();

    return { before, events };
  });

  expect(result).toEqual({ before: [], events: [1140] });
});

test('fractional evidence intervals preserve dwell without advancing on idle frames', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const runs = [];

    for (const interval of [0.1, 0.3, 0.7, 1.1, 4.1, 13.37]) {
      const engine = h.createHasta();
      const element = h.element({ x: 103, width: 20 });
      let calls = 0;
      engine
        .track(element)
        .when({ type: 'intersects', withinMs: 120 }, () => calls++, { stableForMs: interval / 2 });
      h.pointer(1000, 100);
      h.pointer(1000 + interval, 101);
      h.frame();
      h.frame(1000 + interval * 1.75);
      const before = calls;
      h.pointer(1000 + interval * 2, 102);
      h.frame();
      runs.push({ before, calls });
      engine.destroy();
      element.remove();
    }

    return runs;
  });

  expect(result).toEqual(Array.from({ length: 6 }, () => ({ before: 0, calls: 1 })));
});

test('coalesced samples use measurement time for stability despite variable delivery delay', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const calls = [];
    engine
      .track(h.element({ x: 230, width: 20 }))
      .when({ type: 'intersects', withinMs: 160 }, (event) => calls.push(event.evaluatedAt), {
        stableForMs: 30,
      });
    h.pointer(1120, 100, 110, {
      coalesced: [
        { timeStamp: 1090, x: 90 },
        { timeStamp: 1100, x: 100 },
      ],
    });
    h.frame();
    h.frame(1155);
    const before = [...calls];
    h.pointer(1160, 130, 110, {
      coalesced: [
        { timeStamp: 1120, x: 120 },
        { timeStamp: 1130, x: 130 },
      ],
    });
    h.frame();
    engine.destroy();

    return { before, calls };
  });

  expect(result).toEqual({ before: [], calls: [1160] });
});

test('same-time replacement cannot independently confirm a new prediction', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const calls = [];
    engine
      .track(h.element({ x: 150, width: 20 }))
      .when({ type: 'intersects', withinMs: 120 }, (event) => calls.push(event.evaluatedAt));
    h.pointer(1000, 0);
    h.pointer(1010, -10);
    h.frame();
    h.pointer(1010, 10);
    h.frame();
    const before = [...calls];
    h.pointer(1020, 20);
    h.frame();
    h.pointer(1030, 30);
    h.frame();
    engine.destroy();

    return { before, calls };
  });

  expect(result).toEqual({ before: [], calls: [1030] });
});

test('actual includeCurrent contact can complete dwell without another movement', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const calls = [];
    engine
      .track(h.element({ x: 100, width: 20 }))
      .when(
        { type: 'intersects', withinMs: 120, includeCurrent: true },
        (event) => calls.push({ time: event.evaluatedAt, eta: event.etaMs }),
        { stableForMs: 30 },
      );
    h.pointer(1000, 90);
    h.pointer(1010, 100);
    h.frame();
    h.frame(1026);
    h.frame(1042);
    engine.destroy();

    return calls;
  });

  expect(result).toEqual([{ time: 1042, eta: 0 }]);
});

test('predicate callbacks also require new measurement evidence', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const calls = [];
    engine.track(h.element({ x: 240 })).when(
      ({ intersection }) => intersection !== null,
      (event) => calls.push(event.evaluatedAt),
    );
    h.pointer(1000, 0);
    h.pointer(1100 - 1, 99);
    h.pointer(1100, 100);
    h.frame();
    h.frame(1132);
    h.frame(1164);
    engine.destroy();

    return calls;
  });

  expect(result).toEqual([]);
});

test('leaving observed contact cannot restart a forecast from the same sample after cooldown', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element({ x: 100, width: 20 });
    const calls = [];
    engine
      .track(element)
      .when(
        { type: 'intersects', withinMs: 120, includeCurrent: true },
        (event) => calls.push(event.evaluatedAt),
        { cooldownMs: 50 },
      );
    h.pointer(1000, 0);
    h.pointer(1010, 10);
    h.frame();
    element.style.top = '500px';
    h.frame(1020);
    h.pointer(1021, 21);
    h.frame();
    element.style.top = '100px';
    element.style.left = '20px';
    h.frame(1030);
    h.frame(1040);
    element.style.left = '80px';
    h.frame(1060);
    const idle = [...calls];
    h.pointer(1061, 61);
    h.frame();
    engine.destroy();

    return { idle, calls };
  });

  expect(result).toEqual({ idle: [1010], calls: [1010, 1061] });
});

test('initially hidden targets consume observations before their first visible prediction', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element({ x: 240, width: 20 });
    element.style.display = 'none';
    const target = engine.track(element);
    const calls = [];
    target.when({ type: 'intersects', withinMs: 120 }, () => calls.push('intersects'));
    target.when(
      ({ intersection }) => intersection !== null,
      () => calls.push('predicate'),
    );

    for (let time = 0; time <= 100; time++) {
      h.pointer(1000 + time, time);
    }

    h.frame();
    element.style.display = '';
    h.frame(1132);
    const idle = [...calls];
    h.pointer(1133, 133);
    h.frame();
    engine.destroy();

    return { idle, calls };
  });

  expect(result).toEqual({ idle: [], calls: ['intersects', 'predicate'] });
});

for (const unavailable of ['all forecasts', 'one rule forecast']) {
  test(`${unavailable} consume rejected evidence before same-time numerical recovery`, async ({
    page,
  }) => {
    const result = await page.evaluate((unavailable) => {
      const h = window.harness;
      const engine = h.createHasta();
      const target = engine.track(h.element({ x: 100, width: 20 }));
      const calls = [];
      const withinMs = unavailable === 'all forecasts' ? 120 : 1e308;
      target.when({ type: 'intersects', withinMs }, (event) => calls.push(event.evaluatedAt));
      h.pointer(1000, 0);
      h.pointer(1010, unavailable === 'all forecasts' ? Number.MAX_VALUE : 20);
      h.frame();
      h.pointer(1010, 10);
      h.frame();
      const corrected = [...calls];
      h.pointer(1020, 20);
      h.frame();
      engine.destroy();

      return { corrected, calls };
    }, unavailable);

    expect(result).toEqual({ corrected: [], calls: [1020] });
  });
}

test('predicate errors consume the rejected sample before recovery', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const errors = [];
    const engine = h.createHasta({ onError: (error) => errors.push(error.message) });
    let fail = true;
    const calls = [];
    engine.track(h.element()).when(
      () => {
        if (fail) {
          throw new Error('predicate failed');
        }

        return true;
      },
      (event) => calls.push(event.evaluatedAt),
    );
    h.pointer(1000, 0);
    h.pointer(1010, 10);
    h.frame();
    fail = false;
    h.frame(1020);
    const idle = [...calls];
    h.pointer(1021, 21);
    h.frame();
    engine.destroy();

    return { idle, calls, errors };
  });

  expect(result).toEqual({ idle: [], calls: [1021], errors: ['predicate failed'] });
});
