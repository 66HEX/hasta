import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

test('a predicate error from an interrupted frame cannot abort its replacement episode', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const errors = [];
    const engine = h.createHasta({ onError: (error) => errors.push(error.message) });
    const signals = [];
    let restart = true;
    engine.track(h.element()).when(
      () => {
        if (restart) {
          restart = false;
          engine.pause();
          engine.resume();
          h.pointer(1040, 0);
          h.pointer(1060, 20);
          h.frame();
          throw new Error('interrupted predicate');
        }

        return true;
      },
      ({ signal }) => signals.push(signal),
    );
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.frame(1070);
    const episodes = signals.map((signal) => signal.aborted);
    engine.destroy();

    return { episodes, errors, pending: h.pendingFrames() };
  });

  expect(result).toEqual({
    episodes: [false],
    errors: ['interrupted predicate'],
    pending: 0,
  });
});

test('a failed measurement from an interrupted frame cannot erase newer bounds', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const errors = [];
    const engine = h.createHasta({ onError: (error) => errors.push(error.message) });
    const element = h.element();
    const target = engine.track(element);
    const measure = element.getBoundingClientRect.bind(element);
    let restart = true;
    element.getBoundingClientRect = () => {
      if (restart) {
        restart = false;
        engine.pause();
        engine.resume();
        h.pointer(1040, 0);
        h.pointer(1060, 20);
        h.frame();
        throw new Error('interrupted measurement');
      }

      return measure();
    };

    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const measuredAt = target.getBounds()?.measuredAt;
    engine.destroy();

    return { measuredAt, errors, pending: h.pendingFrames() };
  });

  expect(result).toEqual({
    measuredAt: 1060,
    errors: ['interrupted measurement'],
    pending: 0,
  });
});

for (const reset of ['pause-resume', 'blur', 'pointercancel']) {
  test(`a predicate can trigger ${reset} without blocking its next callback`, async ({ page }) => {
    const result = await page.evaluate((reset) => {
      const h = window.harness;
      const engine = h.createHasta();
      let first = true;
      const calls = [];
      engine.track(h.element()).when(
        () => {
          if (first) {
            first = false;

            if (reset === 'pause-resume') {
              engine.pause();
              engine.resume();
            } else if (reset === 'blur') {
              window.dispatchEvent(new Event('blur'));
            } else {
              h.pointer(1020, 20, 110, { type: 'pointercancel' });
            }
          }

          return true;
        },
        (event) => calls.push(event.evaluatedAt),
      );
      h.pointer(1000, 0);
      h.pointer(1020, 20);
      h.frame();
      const afterReset = [...calls];
      h.pointer(1040, 0);
      h.pointer(1060, 20);
      h.frame();
      h.frame(1070);
      engine.destroy();

      return { afterReset, calls, frames: h.pendingFrames() };
    }, reset);

    expect(result).toEqual({ afterReset: [], calls: [1060], frames: 0 });
  });
}

test('a nested reset cannot abort replacement episodes on later subscriptions', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const signals = [[], []];
    let restarted = false;

    function register(index) {
      engine.track(h.element({ x: 100 + index * 30 })).when(
        () => true,
        ({ signal }) => {
          signals[index].push(signal);

          if (index === 0 && !restarted) {
            signal.addEventListener(
              'abort',
              () => {
                restarted = true;
                engine.pause();
                engine.resume();
                h.pointer(1040, 0);
                h.pointer(1060, 20);
                h.frame();
              },
              { once: true },
            );
          }
        },
      );
    }

    register(0);
    register(1);
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    window.dispatchEvent(new Event('blur'));
    h.frame(1070);
    const episodes = signals.map((list) => list.map((signal) => signal.aborted));
    engine.destroy();

    return { episodes, frames: h.pendingFrames() };
  });

  expect(result).toEqual({
    episodes: [
      [true, false],
      [true, false],
    ],
    frames: 0,
  });
});

for (const reset of ['pause-resume', 'blur', 'pointercancel']) {
  for (const coalesced of [false, true]) {
    test(`an abort-side ${reset} discards interrupted input with coalesced=${coalesced}`, async ({
      page,
    }) => {
      const result = await page.evaluate(
        ({ reset, coalesced }) => {
          const h = window.harness;
          const engine = h.createHasta({ debug: true });
          let resetOnce = false;
          const calls = [];
          engine.track(h.element()).when(
            () => true,
            ({ signal, evaluatedAt }) => {
              calls.push(evaluatedAt);
              signal.addEventListener(
                'abort',
                () => {
                  if (resetOnce) {
                    return;
                  }

                  resetOnce = true;

                  if (reset === 'pause-resume') {
                    engine.pause();
                    engine.resume();
                  } else if (reset === 'blur') {
                    window.dispatchEvent(new Event('blur'));
                  } else {
                    h.pointer(1140, 30, 110, { type: 'pointercancel' });
                  }
                },
                { once: true },
              );
            },
          );
          h.pointer(1000, 0);
          h.pointer(1020, 20);
          h.frame();
          h.pointer(
            1140,
            40,
            110,
            coalesced
              ? {
                  coalesced: [
                    { timeStamp: 1130, x: 30 },
                    { timeStamp: 1140, x: 40 },
                  ],
                }
              : {},
          );
          h.frame();
          const afterReset = engine.getDebugSnapshot().status;
          h.pointer(1160, 50);
          h.frame();
          const afterOne = [...calls];
          h.pointer(1180, 60);
          h.frame();
          const afterTwo = [...calls];
          engine.destroy();

          return { afterReset, afterOne, afterTwo, frames: h.pendingFrames() };
        },
        { reset, coalesced },
      );

      expect(result).toEqual({
        afterReset: 'idle',
        afterOne: [1020],
        afterTwo: [1020, 1180],
        frames: 0,
      });
    });
  }
}
