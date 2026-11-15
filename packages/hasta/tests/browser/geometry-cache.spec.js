import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

for (const bounds of ['cached', 'frame']) {
  test(`${bounds} geometry honors its measurement policy and immutable snapshots`, async ({
    page,
  }) => {
    const result = await page.evaluate((mode) => {
      const h = window.harness;
      const engine = h.createHasta({ bounds: mode });
      const element = h.element();
      let reads = 0;
      const native = element.getBoundingClientRect.bind(element);
      element.getBoundingClientRect = () => {
        reads++;

        return native();
      };

      const target = engine.track(element);
      h.pointer(1000, 0);
      h.pointer(1020, 20);
      h.frame();
      const first = target.getBounds();

      for (const time of [1030, 1040, 1050]) {
        h.pointer(time, time - 1000);
        h.frame();
      }

      const last = target.getBounds();
      engine.destroy();

      return {
        reads,
        first: first.measuredAt,
        last: last.measuredAt,
        frozen: Object.isFrozen(first.rect),
      };
    }, bounds);

    expect(result).toEqual({
      reads: bounds === 'cached' ? 1 : 4,
      first: 1020,
      last: bounds === 'cached' ? 1020 : 1050,
      frozen: true,
    });
  });
}

test('CSSOM changes support per-target and global explicit invalidation', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const style = document.createElement('style');
    style.textContent = '.cached-position { transform: translateX(0px); }';
    document.head.append(style);
    const engine = h.createHasta();
    const elements = [h.element(), h.element()];
    const reads = [0, 0];

    const targets = elements.map((element, index) => {
      element.classList.add('cached-position');
      const native = element.getBoundingClientRect.bind(element);
      element.getBoundingClientRect = () => {
        reads[index]++;

        return native();
      };

      return engine.track(element);
    });

    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    style.sheet.cssRules[0].style.transform = 'translateX(50px)';
    targets[0].invalidate();
    h.frame(1030);
    const partial = targets.map((target) => target.getBounds().rect.minX);
    engine.invalidate();
    h.frame(1040);
    const all = targets.map((target) => target.getBounds().rect.minX);
    engine.destroy();

    return { partial, all, reads, pending: h.pendingFrames() };
  });

  expect(result).toEqual({ partial: [150, 100], all: [150, 150], reads: [3, 2], pending: 0 });
});

test('a synchronous ancestor mutation brings an uncached candidate into the path', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const parent = document.createElement('section');
    document.body.append(parent);
    const engine = h.createHasta();
    const element = h.element({ x: 900, parent });
    const target = engine.track(element);
    const times = [];
    target.when({ type: 'intersects', withinMs: 120 }, (event) => times.push(event.evaluatedAt));
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    parent.style.transform = 'translateX(-800px)';
    h.pointer(1040, 40);
    h.frame();
    const x = target.getBounds().rect.minX;
    engine.destroy();

    return { times, x };
  });

  expect(result).toEqual({ times: [1040], x: 100 });
});

test('paused animations are remeasured when their current time changes', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta();
    const element = h.element();

    const animation = element.animate(
      [{ transform: 'translateX(0px)' }, { transform: 'translateX(200px)' }],
      { duration: 1000, fill: 'both' },
    );

    animation.pause();
    animation.currentTime = 0;
    const target = engine.track(element);
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    animation.currentTime = 500;
    h.frame(1040);
    const x = target.getBounds().rect.minX;
    animation.cancel();
    h.frame(1060);
    const restored = target.getBounds().rect.minX;
    engine.destroy();

    return { x, restored };
  });

  expect(result.x).toBeCloseTo(200, 5);
  expect(result.restored).toBe(100);
});

test('controller option changes switch geometry policy without retaining the old runtime', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const { createHastaController } = await import('/dist/vanilla/index.js');
    const h = window.harness;
    const controller = createHastaController();

    const target = controller.target({
      when: { type: 'intersects', withinMs: 120 },
      onPredict: () => {},
    });

    target.ref(h.element());
    controller.connect();
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.frame(1030);
    const cached = target.getBounds().measuredAt;
    controller.updateOptions({ bounds: 'frame' });
    h.pointer(1040, 40);
    h.pointer(1060, 60);
    h.frame();
    h.frame(1070);
    const fresh = target.getBounds().measuredAt;
    controller.invalidate();
    controller.destroy();

    return { cached, fresh, pending: h.pendingFrames() };
  });

  expect(result).toEqual({ cached: 1020, fresh: 1070, pending: 0 });
});

test('non-composed load events invalidate geometry inside a tracked shadow root', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const host = document.createElement('section');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = '.target { transform: translateX(0px); }';
    root.append(style);
    const element = h.element({ parent: root });
    element.style.position = 'absolute';
    const engine = h.createHasta();
    const target = engine.track(element);
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    style.sheet.cssRules[0].style.transform = 'translateX(50px)';
    element.dispatchEvent(new Event('load', { composed: false }));
    h.frame(1040);
    const x = target.getBounds().rect.minX;
    engine.destroy();
    element.dispatchEvent(new Event('load', { composed: false }));

    return { x, pending: h.pendingFrames() };
  });

  expect(result).toEqual({ x: 150, pending: 0 });
});
