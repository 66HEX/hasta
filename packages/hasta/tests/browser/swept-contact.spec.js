import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

for (const direction of [1, -1]) {
  for (const coalesced of [false, true]) {
    test(`all three crossed targets survive one frame of ${direction > 0 ? 'rightward' : 'leftward'} ${coalesced ? 'coalesced' : 'separate'} input`, async ({
      page,
    }) => {
      const result = await page.evaluate(
        ({ direction, coalesced }) => {
          const h = window.harness;
          const engine = h.createHasta();
          const calls = [];
          const signals = [];

          for (const x of [100, 200, 300]) {
            engine
              .track(h.element({ x, width: 64 }))
              .when({ type: 'intersects', withinMs: 20, includeCurrent: true }, (event) => {
                calls.push(event.rect.minX);
                signals.push(event.signal);
              });
          }

          const xs = direction === 1 ? [40, 120, 220, 320] : [420, 340, 240, 140];
          h.pointer(1000, xs[0]);
          h.pointer(1010, xs[0]);
          h.frame();

          if (coalesced) {
            h.pointer(1034, xs[3], 110, {
              coalesced: xs.slice(1).map((x, index) => ({ x, timeStamp: 1030 + index * 2 })),
            });
          } else {
            xs.slice(1).forEach((x, index) => h.pointer(1030 + index * 2, x));
          }

          h.frame(1036);
          const first = { calls: [...calls], aborted: signals.map((signal) => signal.aborted) };
          h.frame(1040);
          const second = signals.map((signal) => signal.aborted);
          engine.destroy();

          return { first, second, frames: h.pendingFrames() };
        },
        { direction, coalesced },
      );

      expect(result).toEqual({
        first: { calls: [100, 200, 300], aborted: [false, false, false] },
        second: direction === 1 ? [true, true, false] : [false, true, true],
        frames: 0,
      });
    });
  }
}

test('several left-right reversals before a frame retain every crossed target once', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const calls = [];

    for (const x of [100, 200, 300]) {
      engine
        .track(h.element({ x, width: 64 }))
        .when({ type: 'intersects', withinMs: 20, includeCurrent: true }, (event) =>
          calls.push(event.rect.minX),
        );
    }

    for (const [index, x] of [40, 40, 340, 40, 340, 40].entries()) {
      h.pointer(1000 + index * 4, x);
    }

    h.frame(1024);
    engine.destroy();

    return calls;
  });

  expect(result).toEqual([100, 200, 300]);
});

test('a curved observed path does not turn its bounding box into false contacts', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const calls = [];

    for (const [id, x, y] of [
      ['top', 180, 40],
      ['corner', 340, 40],
      ['middle', 180, 180],
    ]) {
      engine
        .track(h.element({ x, y, width: 40, height: 40 }))
        .when({ type: 'intersects', withinMs: 20, includeCurrent: true }, () => calls.push(id));
    }

    h.pointer(1000, 50, 50);
    h.pointer(1010, 350, 50);
    h.pointer(1020, 350, 350);
    h.frame();
    engine.destroy();

    return calls;
  });

  expect(result).toEqual(['top', 'corner']);
});

test('observed-contact margins stay independent and old paths cannot replay after expiry', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const calls = [];
    const target = engine.track(h.element({ x: 200, width: 20 }));
    target.when({ type: 'intersects', withinMs: 20, includeCurrent: true, marginPx: 20 }, () =>
      calls.push('margin'),
    );
    target.when({ type: 'intersects', withinMs: 20, includeCurrent: true }, () =>
      calls.push('plain'),
    );
    h.pointer(1000, 0, 90);
    h.pointer(1010, 400, 90);
    h.frame(1020);
    h.frame(1110);
    h.pointer(1120, 400, 90);
    h.pointer(1130, 400, 90);
    h.frame();
    h.frame(1230);
    const frames = h.pendingFrames();
    engine.destroy();

    return { calls, frames };
  });

  expect(result).toEqual({ calls: ['margin'], frames: 0 });
});

test('replacing a same-time sample does not invent a visit to its discarded coordinate', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    let calls = 0;
    engine
      .track(h.element({ x: 200 }))
      .when({ type: 'intersects', withinMs: 20, includeCurrent: true }, () => calls++);
    h.pointer(1000, 0);
    h.pointer(1010, 400);
    h.pointer(1010, 10);
    h.frame();
    engine.destroy();

    return calls;
  });

  expect(result).toBe(0);
});

for (const reset of ['pause', 'untrack', 'unsubscribe', 'pointercancel']) {
  test(`a ${reset} clears pending observed crossings before a new session`, async ({ page }) => {
    const result = await page.evaluate((reset) => {
      const h = window.harness;
      const engine = h.createHasta();
      const element = h.element({ x: 200, width: 20 });
      const condition = { type: 'intersects', withinMs: 20, includeCurrent: true };
      let calls = 0;
      let target = engine.track(element);
      const callback = () => calls++;
      const unsubscribe = target.when(condition, callback);
      h.pointer(1000, 0);
      h.pointer(1010, 400);

      if (reset === 'pause') {
        engine.pause();
        engine.resume();
      } else if (reset === 'untrack') {
        target.untrack();
        target = engine.track(element);
        target.when(condition, callback);
        unsubscribe();
      } else if (reset === 'unsubscribe') {
        unsubscribe();
        unsubscribe();
        target.when(condition, callback);
      } else {
        h.pointer(1010, 400, 110, { type: 'pointercancel' });
      }

      h.pointer(1020, 400);
      h.pointer(1030, 400);
      h.frame();
      const before = calls;
      h.pointer(1040, 0);
      h.frame();
      engine.destroy();

      return { before, calls, frames: h.pendingFrames() };
    }, reset);

    expect(result).toEqual({ before: 0, calls: 1, frames: 0 });
  });
}

for (const options of [{ once: true }, { stableForMs: 20 }, { cooldownMs: 100 }]) {
  test(`observed crossings respect ${JSON.stringify(options)}`, async ({ page }) => {
    const result = await page.evaluate((options) => {
      const h = window.harness;
      const engine = h.createHasta();
      const calls = [];
      engine
        .track(h.element({ x: 200, width: 20 }))
        .when(
          { type: 'intersects', withinMs: 20, includeCurrent: true },
          (event) => calls.push(event.evaluatedAt),
          options,
        );

      for (const base of [1000, 1040, 1200]) {
        h.pointer(base, 0);
        h.pointer(base + 10, 400);
        h.frame();
        h.frame(base + 20);
      }

      engine.destroy();

      return calls;
    }, options);

    expect(result).toEqual(options.once ? [1010] : options.stableForMs ? [] : [1010, 1210]);
  });
}

test('one thousand reversals in a single frame preserve targets without duplicating callbacks', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const calls = [];

    for (const x of [100, 200, 300]) {
      engine
        .track(h.element({ x, width: 20 }))
        .when({ type: 'intersects', withinMs: 20, includeCurrent: true }, (event) =>
          calls.push(event.rect.minX),
        );
    }

    for (let index = 0; index <= 1000; index++) {
      h.pointer(1000 + index / 100, index % 2 ? 400 : 0);
    }

    h.frame(1011);
    h.frame(1110);
    const frames = h.pendingFrames();
    engine.destroy();

    return { calls, frames };
  });

  expect(result).toEqual({ calls: [100, 200, 300], frames: 0 });
});

test('observed contact cannot leak into a predictive-only rule sharing the same geometry', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const target = engine.track(h.element({ x: 200, width: 20 }));
    const calls = [];

    for (const includeCurrent of [false, true, false, true]) {
      target.when({ type: 'intersects', withinMs: 20, includeCurrent }, () =>
        calls.push(includeCurrent),
      );
    }

    h.pointer(1000, 0);
    h.pointer(1010, 400);
    h.frame();
    engine.destroy();

    return calls;
  });

  expect(result).toEqual([true, true]);
});

test('observed contacts never overlap an unresolved callback or replay a skipped crossing later', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.harness;
    const engine = h.createHasta();
    const calls = [];
    const signals = [];
    let settle;

    const pending = new Promise((resolve) => {
      settle = resolve;
    });

    engine
      .track(h.element({ x: 200, width: 20 }))
      .when({ type: 'intersects', withinMs: 20, includeCurrent: true }, (event) => {
        calls.push(event.evaluatedAt);
        signals.push(event.signal);

        return pending;
      });

    for (const base of [1000, 1040]) {
      h.pointer(base, 0);
      h.pointer(base + 10, 400);
      h.frame();
      h.frame(base + 20);
    }

    settle();
    await Promise.resolve();
    h.frame(1070);
    const before = [...calls];
    h.pointer(1080, 0);
    h.frame();
    engine.destroy();

    return {
      before,
      calls,
      aborted: signals.every((signal) => signal.aborted),
      frames: h.pendingFrames(),
    };
  });

  expect(result).toEqual({ before: [1010], calls: [1010, 1080], aborted: true, frames: 0 });
});

test('enabling current contact during a warm session keeps the starting observation of the next crossing', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const target = engine.track(h.element({ x: 200, width: 20 }));
    const calls = [];
    target.when({ type: 'intersects', withinMs: 20 }, () => calls.push('predictive'));
    h.pointer(1000, 0);
    h.pointer(1010, 0);
    h.frame();
    target.when({ type: 'intersects', withinMs: 20, includeCurrent: true }, () =>
      calls.push('observed'),
    );
    h.pointer(1020, 400);
    h.frame();
    engine.destroy();

    return calls;
  });

  expect(result).toEqual(['observed']);
});
