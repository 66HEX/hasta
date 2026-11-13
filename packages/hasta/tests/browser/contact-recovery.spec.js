import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

for (const [name, dx, dy] of [
  ['right', 1, 0],
  ['left', -1, 0],
  ['down', 0, 1],
  ['up', 0, -1],
]) {
  test(`current contact survives ${name} extrapolation beyond the observed target`, async ({
    page,
  }) => {
    const result = await page.evaluate(
      ({ dx, dy }) => {
        const h = window.harness;
        const engine = h.createHasta({ debug: true });
        const target = engine.track(h.element({ width: 100, height: 100 }));
        const hits = [];
        let predictive = 0;
        target.when({ type: 'intersects', withinMs: 120, includeCurrent: true }, (event) =>
          hits.push({ eta: event.etaMs, point: event.intersection.point }),
        );
        target.when(
          { type: 'intersects', withinMs: 120, includeCurrent: false },
          () => predictive++,
        );
        h.pointer(1000, 150 - dx * 40, 150 - dy * 40);
        h.pointer(1010, 150 + dx * 30, 150 + dy * 30);
        h.frame(1020);
        const snapshot = engine.getDebugSnapshot();
        engine.destroy();

        return { hits, predictive, matches: snapshot.targets[0].rules.map((rule) => rule.matches) };
      },
      { dx, dy },
    );

    expect(result).toEqual({
      hits: [{ eta: 0, point: { x: 150 + dx * 30, y: 150 + dy * 30 } }],
      predictive: 0,
      matches: [true, false],
    });
  });

  test(`an approaching ${name} episode stays alive on observed arrival until actual departure`, async ({
    page,
  }) => {
    const result = await page.evaluate(
      ({ dx, dy }) => {
        const h = window.harness;
        const engine = h.createHasta();
        const events = [];
        engine
          .track(h.element({ width: 100, height: 100 }))
          .when({ type: 'intersects', withinMs: 120 }, (event) => events.push(event));
        h.pointer(1000, 150 - dx * 120, 150 - dy * 120);
        h.pointer(1020, 150 - dx * 100, 150 - dy * 100);
        h.frame();
        h.pointer(1040, 150 + dx * 30, 150 + dy * 30);
        h.frame(1050);
        const arrived = { count: events.length, aborted: events[0]?.signal.aborted };
        h.pointer(1070, 150 + dx * 100, 150 + dy * 100);
        h.frame();
        const departed = events[0]?.signal.aborted;
        engine.destroy();

        return { arrived, departed, frames: h.pendingFrames() };
      },
      { dx, dy },
    );

    expect(result).toEqual({ arrived: { count: 1, aborted: false }, departed: true, frames: 0 });
  });
}

for (const includeCurrent of [false, true]) {
  test(`ten idle/warmup cycles inside a target honor includeCurrent=${includeCurrent}`, async ({
    page,
  }) => {
    const result = await page.evaluate((includeCurrent) => {
      const h = window.harness;
      const engine = h.createHasta();
      const signals = [];
      const warmups = [];
      const cycles = [];
      engine
        .track(h.element({ width: 100, height: 100 }))
        .when({ type: 'intersects', withinMs: 120, includeCurrent }, (event) =>
          signals.push(event.signal),
        );

      for (let cycle = 0; cycle < 10; cycle++) {
        const time = 1000 + cycle * 200;
        h.pointer(time, 145, 150);
        h.frame();
        warmups.push(signals.length);
        h.pointer(time + 10, 150, 150);
        h.frame(time + 30);
        h.frame(time + 110);
        cycles.push({
          count: signals.length,
          aborted: signals.every((signal) => signal.aborted),
          frames: h.pendingFrames(),
        });
      }

      engine.destroy();

      return { warmups, cycles };
    }, includeCurrent);

    expect(result.warmups).toEqual(
      Array.from({ length: 10 }, (_, index) => (includeCurrent ? index : 0)),
    );
    expect(result.cycles).toEqual(
      Array.from({ length: 10 }, (_, index) => ({
        count: includeCurrent ? index + 1 : 0,
        aborted: true,
        frames: 0,
      })),
    );
  });
}

test('current-contact margins do not contaminate other rules sharing an intersection cache', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const target = engine.track(h.element({ width: 100, height: 100 }));
    const fired = [];
    target.when(
      { type: 'intersects', withinMs: 120, marginPx: 20, includeCurrent: true },
      (event) => fired.push(['current', event.etaMs]),
    );
    target.when({ type: 'intersects', withinMs: 120, marginPx: 20 }, () =>
      fired.push(['predictive']),
    );
    target.when({ type: 'intersects', withinMs: 120, includeCurrent: true }, () =>
      fired.push(['no-margin']),
    );
    target.when(
      () => false,
      () => fired.push(['predicate']),
    );
    h.pointer(1000, 95, 150);
    h.pointer(1010, 85, 150);
    h.frame(1030);
    engine.destroy();

    return fired;
  });

  expect(result).toEqual([['current', 0]]);
});

for (const pointerType of ['touch', 'pen']) {
  for (const type of [
    'pointerdown',
    'pointerup',
    'pointercancel',
    'lostpointercapture',
    'pointerout',
  ]) {
    test(`${pointerType} ${type} cannot cancel a mouse session with the same numeric ID`, async ({
      page,
    }) => {
      const result = await page.evaluate(
        ({ pointerType, type }) => {
          const h = window.harness;
          const engine = h.createHasta();
          const signals = [];
          engine
            .track(h.element())
            .when({ type: 'intersects', withinMs: 120 }, (event) => signals.push(event.signal));
          h.pointer(1000, 0);
          h.pointer(1020, 20);
          h.frame();
          h.pointer(1030, 200, 200, { pointerType, type, pointerId: 1, relatedTarget: null });
          h.frame(1040);
          const state = { count: signals.length, aborted: signals[0]?.aborted };
          engine.destroy();

          return state;
        },
        { pointerType, type },
      );

      expect(result).toEqual({ count: 1, aborted: false });
    });
  }
}

for (const [dx, dy] of [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]) {
  for (const includeCurrent of [false, true]) {
    test(`a narrow crossing between sample time and frame time stays one episode (${dx},${dy},${includeCurrent})`, async ({
      page,
    }) => {
      const result = await page.evaluate(
        ({ dx, dy, includeCurrent }) => {
          const h = window.harness;
          const engine = h.createHasta();
          const events = [];
          engine
            .track(h.element({ x: 199, y: 199, width: 2, height: 2 }))
            .when({ type: 'intersects', withinMs: 120, includeCurrent }, (event) =>
              events.push(event),
            );
          h.pointer(1000, 200 - dx * 40, 200 - dy * 40);
          h.pointer(1020, 200 - dx * 20, 200 - dy * 20);
          h.frame();
          h.frame(1050);
          const between = { count: events.length, aborted: events[0]?.signal.aborted };
          h.pointer(1060, 200 + dx * 20, 200 + dy * 20);
          h.frame();
          h.frame(1061);

          const after = {
            count: events.length,
            aborted: events.every((event) => event.signal.aborted),
          };

          engine.destroy();

          return { between, after };
        },
        { dx, dy, includeCurrent },
      );

      expect(result).toEqual({
        between: { count: 1, aborted: false },
        after: { count: 1, aborted: true },
      });
    });
  }
}
