import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

test('every target is measured each active frame, including offscreen and unmatched targets', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const reads = [0, 0, 0];
    const elements = [h.element(), h.element({ y: 1000 }), h.element({ x: 700 })];

    const targets = elements.map((element, index) => {
      const measure = element.getBoundingClientRect.bind(element);
      element.getBoundingClientRect = () => {
        reads[index]++;

        return measure();
      };

      const target = engine.track(element);
      target.when({ type: 'intersects', withinMs: 120 }, () => {});

      return target;
    });

    const snapshots = [];

    for (let frame = 0; frame < 5; frame++) {
      elements[1].style.transform = `translateY(${-frame * 100}px)`;
      h.pointer(1000 + frame * 16, frame, 0);
      h.frame();
      snapshots.push(targets[1].getBounds());
    }

    engine.destroy();

    return {
      reads,
      positions: snapshots.map((snapshot) => snapshot.rect.minY),
      times: snapshots.map((snapshot) => snapshot.measuredAt),
      frozen: snapshots.every(
        (snapshot) => Object.isFrozen(snapshot) && Object.isFrozen(snapshot.rect),
      ),
    };
  });

  expect(result).toEqual({
    reads: [5, 5, 5],
    positions: [1000, 900, 800, 700, 600],
    times: [1000, 1016, 1032, 1048, 1064],
    frozen: true,
  });
});

test('lazy public snapshots preserve old predicate and debug geometry across moves', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta({ debug: { labels: false, panel: false } });
    const element = h.element();
    const target = engine.track(element);
    const contexts = [];
    target.when(
      (context) => {
        contexts.push(context);

        return false;
      },
      () => {},
    );
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const initial = target.getBounds();
    const debug = engine.getDebugSnapshot();
    element.style.transform = 'translateX(80px)';
    h.pointer(1036, 36);
    h.frame();
    const moved = target.getBounds();
    h.pointer(1052, 52);
    h.frame();
    const unchanged = target.getBounds();
    const debugTarget = debug.targets.find((item) => item.id === debug.targets[0].id);

    const output = {
      xs: [
        initial.rect.minX,
        moved.rect.minX,
        unchanged.rect.minX,
        debugTarget.rect.minX,
        contexts[0].rect.minX,
      ],
      times: [initial.measuredAt, moved.measuredAt, unchanged.measuredAt],
      frozen: [initial, moved, unchanged, contexts[0], debugTarget].every(
        (item) => Object.isFrozen(item) && Object.isFrozen(item.rect),
      ),
      rectKeys: Object.keys(contexts[0].rect).toSorted(),
    };

    engine.destroy();

    return output;
  });

  expect(result).toEqual({
    xs: [100, 180, 180, 100, 100],
    times: [1020, 1036, 1052],
    frozen: true,
    rectKeys: ['maxX', 'maxY', 'minX', 'minY'],
  });
});

test('rules added after a frame immediately expand candidate horizons and margins', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const distant = engine.track(h.element({ x: 400 }));
    const offset = engine.track(h.element({ x: 200, y: 200 }));
    const calls = [];
    distant.when({ type: 'intersects', withinMs: 50 }, () => calls.push('short'));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const before = calls.length;
    distant.when({ type: 'intersects', withinMs: 500 }, () => calls.push('long'), { once: true });
    offset.when({ type: 'intersects', withinMs: 120, marginPx: 100 }, () => calls.push('margin'), {
      once: true,
    });
    h.pointer(1036, 36);
    h.frame();
    engine.destroy();

    return { before, calls };
  });

  expect(result).toEqual({ before: 0, calls: ['long', 'margin'] });
});
