import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

test('fractional event timestamps preserve corner hits on fresh input', async ({ page }) => {
  const failures = await page.evaluate(() => {
    const h = window.harness;
    const failures = [];

    for (const interval of [0.1, 0.3, 0.7, 1.1, 4.1, 13.37]) {
      for (const dx of [1, 3, 7]) {
        for (const dy of [1, 3, 7]) {
          const element = h.element({ x: 100 + 3 * dx, y: 100, width: dx, height: 3 * dy });
          const engine = h.createHasta();
          const events = [];
          engine
            .track(element)
            .when({ type: 'intersects', withinMs: 120 }, (event) => events.push(event));
          h.pointer(1000, 100, 100);
          h.pointer(1000 + interval, 100 + dx, 100 + dy);
          h.frame();
          h.frame(1000 + 2 * interval);

          if (events.length !== 1 || events[0].signal.aborted) {
            failures.push({ interval, dx, dy, count: events.length });
          }

          engine.destroy();
          element.remove();
        }
      }
    }

    return failures;
  });

  expect(failures).toEqual([]);
});

test('a corner approach remains one episode between input samples', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const events = [];
    engine
      .track(h.element({ x: 106, y: 100, width: 1, height: 2 }))
      .when({ type: 'intersects', withinMs: 120 }, (event) => events.push(event));
    h.pointer(1000, 100, 100);
    h.pointer(1007, 103, 101);
    const frames = [];

    for (let now = 1007; now < 1014; now++) {
      h.frame(now);
      frames.push({ count: events.length, aborted: events.some((event) => event.signal.aborted) });
    }

    const hits = events.map((event) => ({
      at: event.predictedAt,
      point: event.intersection.point,
    }));

    engine.destroy();

    return { frames, hits, pending: h.pendingFrames() };
  });

  expect(result).toEqual({
    frames: Array.from({ length: 7 }, () => ({ count: 1, aborted: false })),
    hits: [{ at: 1014, point: { x: 106, y: 102 } }],
    pending: 0,
  });
});

test('adding a longer rule cannot change another rule’s corner intersection', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const runs = [];

    for (const extraHorizon of [null, 200, 500, 1e6]) {
      const engine = h.createHasta();
      const element = h.element({ x: 2, y: 0, width: 1, height: 6 });
      const target = engine.track(element);
      const hits = [];
      target.when({ type: 'intersects', withinMs: 120 }, (event) =>
        hits.push({ eta: event.etaMs, point: event.intersection.point, forecast: event.forecast }),
      );

      if (extraHorizon !== null) {
        target.when({ type: 'intersects', withinMs: extraHorizon }, () => {});
      }

      h.pointer(1000, 0, 0);
      h.pointer(1003, 1, 3);
      h.frame();
      runs.push(hits);
      engine.destroy();
      element.remove();
    }

    return runs;
  });

  expect(result[0]).toHaveLength(1);
  expect(result[0][0].eta).toBe(3);
  expect(result[0][0].point).toEqual({ x: 2, y: 6 });

  for (const run of result.slice(1)) {
    expect(run).toEqual(result[0]);
  }
});

test('the candidate scan retains a boundary reached exactly at the horizon', async ({ page }) => {
  const hits = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta({ horizonMs: 49 });
    const events = [];
    engine
      .track(h.element({ x: 0, y: 100, width: 1, height: 1 }))
      .when({ type: 'intersects', withinMs: 49 }, (event) =>
        events.push({ eta: event.etaMs, point: event.intersection.point }),
      );
    h.pointer(1000, -2, 100.5);
    h.pointer(1049, -1, 100.5);
    h.frame();
    engine.destroy();

    return events;
  });

  expect(hits).toEqual([{ eta: 49, point: { x: 0, y: 100.5 } }]);
});

test('a stable corner prediction matures without resetting the dwell timer between frames', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const events = [];
    engine
      .track(h.element({ x: 160, y: 100, width: 1, height: 20 }))
      .when({ type: 'intersects', withinMs: 120 }, (event) => events.push(event), {
        stableForMs: 40,
      });
    h.pointer(1000, 100, 100);

    for (let now = 1007; now <= 1140; now++) {
      if ((now - 1000) % 7 === 0) {
        const step = (now - 1000) / 7;
        h.pointer(now, 100 + step * 3, 100 + step);
      }

      h.frame(now);
    }

    const hits = events.map((event) => ({
      at: event.evaluatedAt,
      predictedAt: event.predictedAt,
      aborted: event.signal.aborted,
    }));

    h.pointer(1147, 163, 121);
    h.frame();
    const departed = events.every((event) => event.signal.aborted);
    engine.destroy();

    return { hits, departed };
  });

  expect(result).toEqual({
    hits: [{ at: 1063, predictedAt: 1140, aborted: false }],
    departed: true,
  });
});

for (const coalesced of [false, true]) {
  for (const reverse of [false, true]) {
    test(`fast sweeps retain every subpixel target and reject the adjacent lane (${coalesced}, ${reverse})`, async ({
      page,
    }) => {
      const result = await page.evaluate(
        ({ coalesced, reverse }) => {
          const h = window.harness;
          const engine = h.createHasta();
          const hits = [];
          const signals = [];

          for (let index = 0; index < 24; index++) {
            for (const adjacent of [false, true]) {
              const element = h.element({
                x: 200 + index * 0.0625,
                y: adjacent ? 100.0625 : 100,
                width: 0.03125,
                height: 0.03125,
              });

              engine
                .track(element)
                .when({ type: 'intersects', withinMs: 120, includeCurrent: true }, (event) => {
                  hits.push({ index, adjacent, eta: event.etaMs });
                  signals.push(event.signal);
                });
            }
          }

          const samples = [
            { x: reverse ? 300 : 100, y: 100.015625, timeStamp: 1000 },
            { x: reverse ? 100 : 300, y: 100.015625, timeStamp: 1001 },
          ];

          if (coalesced) {
            h.pointer(1001, samples[1].x, samples[1].y, { coalesced: samples });
          } else {
            samples.forEach((sample) => h.pointer(sample.timeStamp, sample.x, sample.y));
          }

          h.frame(1016);
          h.frame(1017);
          const aborted = signals.every((signal) => signal.aborted);
          engine.destroy();

          return { hits, aborted, pending: h.pendingFrames() };
        },
        { coalesced, reverse },
      );

      expect(result).toEqual({
        hits: Array.from({ length: 24 }, (_, index) => ({ index, adjacent: false, eta: 0 })),
        aborted: true,
        pending: 0,
      });
    });
  }
}

for (const horizontal of [false, true]) {
  for (const direction of [-1, 1]) {
    for (const includeCurrent of [false, true]) {
      test(`subpixel corridors preserve gaps and explicit margins (${horizontal}, ${direction}, ${includeCurrent})`, async ({
        page,
      }) => {
        const failures = await page.evaluate(
          ({ horizontal, direction, includeCurrent }) => {
            const h = window.harness;
            const failures = [];

            for (const gap of [1 / 32, 0.25, 1, 4]) {
              for (const marginScale of [0, 0.5, 1, 2]) {
                for (const phase of [0, 5, 19]) {
                  const point = (along, across) =>
                    horizontal ? { x: along, y: across } : { x: across, y: along };

                  const elements = [256 - gap / 2 - 40, 256 + gap / 2].map((across) =>
                    h.element({
                      ...point(200, across),
                      width: horizontal ? 80 : 40,
                      height: horizontal ? 40 : 80,
                    }),
                  );

                  const boxes = elements.map((element) => element.getBoundingClientRect());
                  const low = horizontal ? boxes[0].bottom : boxes[0].right;
                  const high = horizontal ? boxes[1].top : boxes[1].left;
                  const center = (low + high) / 2;
                  const marginPx = ((high - low) / 2) * marginScale;
                  const engine = h.createHasta();
                  const events = [[], []];
                  elements.forEach((element, index) => {
                    engine
                      .track(element)
                      .when(
                        { type: 'intersects', withinMs: 160, marginPx, includeCurrent },
                        (event) => events[index].push(event),
                      );
                  });

                  for (let step = 0; step < 11; step++) {
                    const position = point(
                      direction > 0 ? 140 + step * 20 : 340 - step * 20,
                      center,
                    );

                    h.pointer(1000 + step * 20, position.x, position.y);
                    h.frame(1000 + step * 20 + phase);
                  }

                  h.frame(1220);
                  const counts = events.map((list) => list.length);
                  const expected = marginScale >= 1 ? 1 : 0;

                  if (
                    counts.some((count) => count !== expected) ||
                    events.flat().some((event) => !event.signal.aborted)
                  ) {
                    failures.push({ gap, marginScale, phase, counts });
                  }

                  engine.destroy();
                  elements.forEach((element) => element.remove());
                }
              }
            }

            return failures;
          },
          { horizontal, direction, includeCurrent },
        );

        expect(failures).toEqual([]);
      });
    }
  }
}

for (const swap of [false, true]) {
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      test(`diagonal tangencies and near misses remain distinct (${swap}, ${signX}, ${signY})`, async ({
        page,
      }) => {
        const failures = await page.evaluate(
          ({ swap, signX, signY }) => {
            const h = window.harness;
            const failures = [];

            const point = (x, y) => ({
              x: 200 + signX * (swap ? y : x),
              y: 200 + signY * (swap ? x : y),
            });

            for (const gap of [-1 / 32, 0, 1 / 32]) {
              for (const horizon of [7, 60, 120, 300]) {
                for (const age of [0, 1, 3, 6]) {
                  const a = point(6, 0);
                  const b = point(7, 2 + gap);

                  const element = h.element({
                    x: Math.min(a.x, b.x),
                    y: Math.min(a.y, b.y),
                    width: Math.abs(b.x - a.x),
                    height: Math.abs(b.y - a.y),
                  });

                  const engine = h.createHasta({ horizonMs: horizon });
                  const hits = [];
                  const target = engine.track(element);
                  target.when({ type: 'intersects', withinMs: horizon }, (event) =>
                    hits.push({ point: event.intersection.point, at: event.predictedAt }),
                  );
                  let predicateHit = null;
                  target.when(
                    (context) => {
                      predicateHit = context.intersection;

                      return false;
                    },
                    () => {},
                  );
                  const start = point(0, 0);
                  const latest = point(3, 1);
                  h.pointer(1000, start.x, start.y);
                  h.pointer(1007, latest.x, latest.y);
                  h.frame(1007 + age);
                  const expected = gap < 0 ? 0 : 1;

                  if (
                    hits.length !== expected ||
                    (predicateHit !== null) !== (expected === 1) ||
                    hits.some(
                      (hit) =>
                        hit.at !== 1014 ||
                        hit.point.x !== point(6, 2).x ||
                        hit.point.y !== point(6, 2).y,
                    )
                  ) {
                    failures.push({ gap, horizon, age, hits, predicateHit });
                  }

                  engine.destroy();
                  element.remove();
                }
              }
            }

            return failures;
          },
          { swap, signX, signY },
        );

        expect(failures).toEqual([]);
      });
    }
  }
}

for (const coalesced of [false, true]) {
  test(`sustained turns predict a narrow channel within 32ms without hitting its neighbor (${coalesced})`, async ({
    page,
  }) => {
    const result = await page.evaluate((coalesced) => {
      const h = window.harness;
      const engine = h.createHasta();
      const hits = [];
      const signals = [];
      const predictions = [];

      for (const [name, bounds] of [
        ['right', { x: 200, y: 99.984375, width: 1, height: 0.03125 }],
        ['down', { x: 159.984375, y: 140, width: 0.03125, height: 1 }],
        ['diagonal', { x: 170, y: 110, width: 1, height: 1 }],
      ]) {
        engine
          .track(h.element(bounds))
          .when({ type: 'intersects', withinMs: 120, includeCurrent: true }, (event) => {
            hits.push(name);
            signals.push(event.signal);
            predictions.push({ at: event.evaluatedAt, eta: event.etaMs });
          });
      }

      const move = (samples) => {
        if (coalesced) {
          const last = samples.at(-1);
          h.pointer(last.timeStamp, last.x, last.y, { coalesced: samples });
        } else {
          samples.forEach((sample) => h.pointer(sample.timeStamp, sample.x, sample.y));
        }

        h.frame();
      };

      move([
        { x: 140, y: 100, timeStamp: 1000 },
        { x: 150, y: 100, timeStamp: 1010 },
      ]);
      move([
        { x: 160, y: 100, timeStamp: 1020 },
        { x: 160, y: 110, timeStamp: 1030 },
      ]);
      const initialTurnAborted = signals[0].aborted;

      move(
        Array.from({ length: 20 }, (_, index) => ({
          x: 160,
          y: 111 + index,
          timeStamp: 1031 + index,
        })),
      );

      const afterTurn = signals.map((signal) => signal.aborted);
      move([{ x: 160, y: 100, timeStamp: 1060 }]);
      const immediateReversalAborted = signals[1]?.aborted;
      move([{ x: 150, y: 100, timeStamp: 1070 }]);
      const afterReversal = signals.map((signal) => signal.aborted);
      move([
        { x: 160, y: 100, timeStamp: 1080 },
        { x: 168, y: 100, timeStamp: 1088 },
      ]);

      move(
        Array.from({ length: 24 }, (_, index) => ({
          x: 169 + index,
          y: 100,
          timeStamp: 1089 + index,
        })),
      );

      h.frame(1113);
      engine.destroy();

      return {
        hits,
        predictions,
        initialTurnAborted,
        immediateReversalAborted,
        afterTurn,
        afterReversal,
        pending: h.pendingFrames(),
      };
    }, coalesced);

    const { predictions, ...episodes } = result;
    expect(episodes).toEqual({
      hits: ['right', 'down', 'right'],
      initialTurnAborted: true,
      immediateReversalAborted: true,
      afterTurn: [true, false],
      afterReversal: [true, true],
      pending: 0,
    });
    expect(predictions.every((prediction) => prediction.eta > 0)).toBe(true);
    expect(predictions[1].at - 1030).toBeLessThanOrEqual(32);
    expect(predictions[2].at - 1080).toBeLessThanOrEqual(32);
  });
}
