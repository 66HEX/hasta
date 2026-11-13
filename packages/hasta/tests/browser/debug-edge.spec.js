import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
  await page.evaluate(async () => {
    const { createDebugOverlay } = await import('/dist/runtime/debug/overlay.js');
    window.debugRenderer = createDebugOverlay;
    window.debugState = (targets, fields = {}) => ({
      timeStamp: 1000,
      status: 'idle',
      samples: [],
      forecast: null,
      pointer: null,
      velocity: null,
      sampleAgeMs: null,
      horizonMs: 120,
      maxSampleAgeMs: 100,
      targets,
      ...fields,
    });
    window.debugTarget = (id, fields = {}) => ({
      id,
      label: `target ${id}`,
      rect: {
        minX: 50 + (id % 5) * 100,
        minY: 50 + Math.floor(id / 5) * 100,
        maxX: 100 + (id % 5) * 100,
        maxY: 100 + Math.floor(id / 5) * 100,
      },
      measuredAt: 1000,
      candidate: false,
      rules: [],
      ...fields,
    });
    window.debugRule = (id, fields = {}) => ({
      id,
      kind: 'intersects',
      withinMs: 120,
      marginPx: 0,
      includeCurrent: false,
      matches: false,
      eligible: false,
      latched: false,
      running: false,
      once: false,
      stableForMs: 0,
      cooldownMs: 0,
      fireCount: 0,
      lastFiredAt: null,
      intersection: null,
      ...fields,
    });
  });
});

test('unchanged geometry keeps DOM nodes while measurement timestamps advance', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const targets = Array.from({ length: 20 }, (_, id) => window.debugTarget(id));
    const overlay = window.debugRenderer(document, {});
    overlay.render(window.debugState(targets));
    const shadow = document.querySelector('[data-hasta-debug]').shadowRoot;
    const first = shadow.querySelector('[data-hasta-target="0"]');
    const heading = shadow.querySelector('.heading');
    let created = 0;
    const createSVG = document.createElementNS;
    const createHTML = document.createElement;
    document.createElementNS = function (...args) {
      created++;

      return createSVG.apply(this, args);
    };

    document.createElement = function (...args) {
      created++;

      return createHTML.apply(this, args);
    };

    try {
      overlay.render(
        window.debugState(
          targets.map((target) => ({ ...target, measuredAt: 1016 })),
          {
            timeStamp: 1016,
            sampleAgeMs: 16,
          },
        ),
      );
    } finally {
      document.createElementNS = createSVG;
      document.createElement = createHTML;
    }

    const stable = {
      sameTarget: first === shadow.querySelector('[data-hasta-target="0"]'),
      samePanel: heading === shadow.querySelector('.heading'),
      created,
      summary: shadow.querySelector('.summary').textContent,
    };

    targets[0] = { ...targets[0], rect: { minX: 200, minY: 100, maxX: 250, maxY: 150 } };
    overlay.render(window.debugState(targets));
    const moved = shadow.querySelector('[data-hasta-bounds="0"]').getAttribute('x');
    overlay.render(window.debugState(targets.slice(1)));
    const removed = shadow.querySelector('[data-hasta-target="0"]') === null;
    overlay.setOptions({ bounds: false, panel: false });
    const hidden = shadow.querySelectorAll('[data-hasta-bounds]').length;
    overlay.setOptions({});
    const restored = shadow.querySelectorAll('[data-hasta-bounds]').length;
    overlay.destroy();
    overlay.destroy();
    overlay.render(window.debugState(targets));
    overlay.setOptions({});

    return {
      stable,
      moved,
      removed,
      hidden,
      restored,
      hosts: document.querySelectorAll('[data-hasta-debug]').length,
    };
  });

  expect(result.stable).toMatchObject({
    sameTarget: true,
    samePanel: true,
    summary: '20 targets · 120 ms ahead',
  });
  expect(result.stable.created).toBeLessThanOrEqual(2);
  expect(result).toMatchObject({ moved: '200', removed: true, hidden: 0, restored: 19, hosts: 0 });
});

test('offscreen boxes do not fill the DOM but visible margins and contacts remain', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const targets = Array.from({ length: 1000 }, (_, id) =>
      window.debugTarget(id, {
        rect: { minX: 2000, minY: 100, maxX: 2050, maxY: 150 },
      }),
    );

    const overlay = window.debugRenderer(document, { panel: false });
    overlay.render(window.debugState(targets));
    const shadow = document.querySelector('[data-hasta-debug]').shadowRoot;
    const offscreenNodes = shadow.querySelectorAll('*').length;

    const edge = window.debugTarget(1001, {
      rect: { minX: -100, minY: 100, maxX: -50, maxY: 150 },
      rules: [
        window.debugRule(0, {
          marginPx: 80,
          matches: true,
          intersection: { etaMs: 20, point: { x: 30, y: 110 } },
        }),
      ],
    });

    overlay.render(
      window.debugState([...targets, edge], {
        forecast: {
          generatedAt: 1000,
          points: [
            { x: 50, y: 110, offsetMs: 0 },
            { x: -70, y: 110, offsetMs: 120 },
          ],
        },
      }),
    );

    const visible = {
      bounds: shadow.querySelectorAll('[data-hasta-bounds]').length,
      margins: shadow.querySelectorAll('[data-hasta-margin]').length,
      contacts: shadow.querySelectorAll('[data-hasta-intersection]').length,
    };

    overlay.setOptions({ panel: true });
    const totals = shadow.querySelector('.summary').textContent;
    overlay.destroy();

    return { offscreenNodes, visible, totals };
  });

  expect(result.offscreenNodes).toBeLessThan(10);
  expect(result.visible).toEqual({ bounds: 0, margins: 1, contacts: 1 });
  expect(result.totals).toBe('1001 targets · 120 ms ahead');
});

test('large rule sets do not expand labels or the compact panel', async ({ page }) => {
  const result = await page.evaluate(() => {
    const rules = Array.from({ length: 10000 }, (_, id) => window.debugRule(id, { fireCount: 1 }));
    const overlay = window.debugRenderer(document, {});
    overlay.render(window.debugState([window.debugTarget(0, { rules })]));
    const shadow = document.querySelector('[data-hasta-debug]').shadowRoot;
    const label = shadow.querySelector('[data-hasta-target-label]');

    const result = {
      lines: label.querySelectorAll('tspan').length,
      text: label.textContent,
      summary: shadow.querySelector('.summary').textContent,
    };

    overlay.destroy();

    return result;
  });

  expect(result.lines).toBe(2);
  expect(result.text).toBe('target 050 × 50');
  expect(result.summary).toBe('1 target · 120 ms ahead');
});

test('rendering reads no target layout and adds no schedulers or event listeners', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const overlay = window.debugRenderer(document, {});

    let frames = 0,
      listeners = 0,
      reads = 0,
      timers = 0;

    const bounds = Element.prototype.getBoundingClientRect;
    const raf = window.requestAnimationFrame;
    const timer = window.setTimeout;
    const listen = EventTarget.prototype.addEventListener;
    Element.prototype.getBoundingClientRect = function () {
      reads++;

      return bounds.call(this);
    };

    window.requestAnimationFrame = function (...args) {
      frames++;

      return raf.apply(this, args);
    };

    window.setTimeout = function (...args) {
      timers++;

      return timer.apply(this, args);
    };

    EventTarget.prototype.addEventListener = function (...args) {
      listeners++;

      return listen.apply(this, args);
    };

    try {
      const targets = [window.debugTarget(0)];

      for (let i = 0; i < 20; i++) {
        overlay.render(window.debugState(targets, { timeStamp: 1000 + i }));
      }

      overlay.setOptions({ labels: false });
      overlay.destroy();
    } finally {
      Element.prototype.getBoundingClientRect = bounds;
      window.requestAnimationFrame = raf;
      window.setTimeout = timer;
      EventTarget.prototype.addEventListener = listen;
    }

    return { reads, frames, timers, listeners };
  });

  expect(result).toEqual({ reads: 0, frames: 0, timers: 0, listeners: 0 });
});

test('dense narrow scenes render without placement work growing with every obstacle', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const result = await page.evaluate(() => {
    const overlay = window.debugRenderer(document, { panel: false });

    const targets = Array.from({ length: 200 }, (_, id) =>
      window.debugTarget(id, {
        rect: {
          minX: (id % 10) * 35,
          minY: Math.floor(id / 10) * 35,
          maxX: (id % 10) * 35 + 20,
          maxY: Math.floor(id / 10) * 35 + 20,
        },
      }),
    );

    // Array.sort is used by collision placement. Guard its input rather than machine timing
    const sort = Array.prototype.sort;
    let largestSort = 0;
    // oxlint-disable-next-line no-extend-native -- Instrument sorting cost and restore the native method in finally
    Array.prototype.sort = function (...args) {
      largestSort = Math.max(largestSort, this.length);

      return sort.apply(this, args);
    };

    try {
      overlay.render(window.debugState(targets));
    } finally {
      // oxlint-disable-next-line no-extend-native -- Restore instrumentation even when the assertion fails
      Array.prototype.sort = sort;
    }

    const shadow = document.querySelector('[data-hasta-debug]').shadowRoot;
    const count = shadow.querySelectorAll('[data-hasta-bounds]').length;

    const finite = [...shadow.querySelectorAll('[data-hasta-label] rect')].every((rect) =>
      ['x', 'y', 'width', 'height'].every((name) =>
        Number.isFinite(Number(rect.getAttribute(name))),
      ),
    );

    overlay.destroy();

    return { largestSort, count, finite };
  });

  expect(result.count).toBe(200);
  expect(result.finite).toBe(true);
  expect(result.largestSort).toBeLessThanOrEqual(200);
});

for (const width of [320, 390, 1000]) {
  test(`labels avoid targets, each other, and the summary at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });

    const result = await page.evaluate((width) => {
      const columns = Math.min(6, Math.floor((width - 32) / 96));

      const targets = Array.from({ length: columns * 3 }, (_, id) =>
        window.debugTarget(id, {
          label: id % 2 ? '日本語と長いラベルの検証' : 'A very long target label with detail',
          rect: {
            minX: 24 + (id % columns) * 96,
            minY: 80 + Math.floor(id / columns) * 120,
            maxX: 88 + (id % columns) * 96,
            maxY: 144 + Math.floor(id / columns) * 120,
          },
          rules: [window.debugRule(id, { marginPx: 8 })],
        }),
      );

      const overlay = window.debugRenderer(document, {});
      overlay.render(window.debugState(targets));
      const shadow = document.querySelector('[data-hasta-debug]').shadowRoot;

      const labels = [...shadow.querySelectorAll('[data-hasta-target-label]')].map((label) => {
        const rect = label.querySelector('rect').getBoundingClientRect();
        const text = label.querySelector('text').getBoundingClientRect();

        return {
          rect: { minX: rect.x, minY: rect.y, maxX: rect.right, maxY: rect.bottom },
          textBounds: { minX: text.x, minY: text.y, maxX: text.right, maxY: text.bottom },
          textFits:
            text.x >= rect.x &&
            text.right <= rect.right &&
            text.y >= rect.y &&
            text.bottom <= rect.bottom,
        };
      });

      const panel = shadow.querySelector('.panel').getBoundingClientRect();

      const obstacles = [
        ...targets.map(({ rect }) => ({
          minX: rect.minX - 8,
          minY: rect.minY - 8,
          maxX: rect.maxX + 8,
          maxY: rect.maxY + 8,
        })),
        { minX: panel.x, minY: panel.y, maxX: panel.right, maxY: panel.bottom },
      ];

      overlay.destroy();

      return { labels, obstacles };
    }, width);

    expect(result.labels.length).toBeGreaterThan(0);
    expect(result.labels.length).toBeLessThanOrEqual(24);

    for (const [index, label] of result.labels.entries()) {
      expect(label.textFits, JSON.stringify(label)).toBe(true);
      expect(label.rect.minX).toBeGreaterThanOrEqual(8);
      expect(label.rect.maxX).toBeLessThanOrEqual(width - 8);
      expect(label.rect.minY).toBeGreaterThanOrEqual(8);
      expect(label.rect.maxY).toBeLessThanOrEqual(692);

      for (const other of [
        ...result.obstacles,
        ...result.labels.slice(index + 1).map((item) => item.rect),
      ]) {
        expect(
          label.rect.minX < other.maxX &&
            label.rect.maxX > other.minX &&
            label.rect.minY < other.maxY &&
            label.rect.maxY > other.minY,
        ).toBe(false);
      }
    }
  });
}

test('debug defaults stay compact while optional trails and full rule telemetry remain available', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const engine = h.createHasta({ debug: true });
    const target = engine.track(h.element({ width: 64, height: 64 }));

    for (const marginPx of [8, 16, 24]) {
      target.when({ type: 'intersects', withinMs: 160, marginPx }, () => {});
    }

    for (let index = 0; index < 32; index++) {
      h.pointer(1000 + index, index);
    }

    h.frame();
    const shadow = document.querySelector('[data-hasta-debug]').shadowRoot;

    const before = {
      margins: [...shadow.querySelectorAll('[data-hasta-margin]')].map(
        (element) => element.dataset.hastaMargin,
      ),
      intersections: shadow.querySelectorAll('[data-hasta-intersection]').length,
      trails: shadow.querySelectorAll('[data-hasta-samples]').length,
      rules: engine.getDebugSnapshot().targets[0].rules.length,
      samples: engine.getDebugSnapshot().samples.length,
    };

    engine.setDebug({ samples: true });
    const trail = shadow.querySelector('[data-hasta-samples]').dataset.hastaSamples;
    engine.destroy();

    return { before, trail };
  });

  expect(result).toEqual({
    before: { margins: ['24'], intersections: 1, trails: 0, rules: 3, samples: 32 },
    trail: '16',
  });
});

test('label dimensions update when changing margin keeps the outer bounds identical', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const overlay = window.debugRenderer(document, { panel: false });
    overlay.render(
      window.debugState([
        window.debugTarget(0, {
          rect: { minX: 100, minY: 100, maxX: 200, maxY: 200 },
          rules: [window.debugRule(0, { marginPx: 10 })],
        }),
      ]),
    );
    overlay.render(
      window.debugState([
        window.debugTarget(0, {
          rect: { minX: 110, minY: 110, maxX: 190, maxY: 190 },
          rules: [window.debugRule(0, { marginPx: 20 })],
        }),
      ]),
    );

    const text = document
      .querySelector('[data-hasta-debug]')
      .shadowRoot.querySelector('[data-hasta-target-label]').textContent;

    overlay.destroy();

    return text;
  });

  expect(result).toBe('target 080 × 80');
});
