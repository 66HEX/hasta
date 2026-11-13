import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
  await page.evaluate(async () => {
    const { createHastaController } = await import('/dist/vanilla/index.js');
    window.createController = createHastaController;
  });
});

test('controller allocations are inert and disconnect/reconnect preserves bound nodes', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const controller = window.createController({ debug: true });

    const target = controller.target({
      when: { type: 'intersects', withinMs: 120 },
      onPredict() {},
    });

    target.ref(h.element());

    const before = {
      hosts: document.querySelectorAll('[data-hasta-debug]').length,
      frames: h.pendingFrames(),
    };

    controller.connect();
    h.frame();
    const first = controller.getDebugSnapshot().targets.length;
    controller.disconnect();
    controller.disconnect();
    const disconnected = controller.getDebugSnapshot();
    controller.connect();
    h.frame();
    const restored = controller.getDebugSnapshot().targets.length;
    target.ref(null);
    h.frame();
    const removed = controller.getDebugSnapshot().targets.length;
    controller.destroy();
    target.destroy();
    controller.destroy();

    return {
      before,
      first,
      disconnected,
      restored,
      removed,
      hosts: document.querySelectorAll('[data-hasta-debug]').length,
      frames: h.pendingFrames(),
    };
  });

  expect(result).toEqual({
    before: { hosts: 0, frames: 0 },
    first: 1,
    disconnected: null,
    restored: 1,
    removed: 0,
    hosts: 0,
    frames: 0,
  });
});

test('bindings sharing one element own independent subscriptions and release it only once', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness,
      signals = [];

    const controller = window.createController({ debug: true });
    const element = h.element();

    const config = {
      when: { type: 'intersects', withinMs: 120 },
      onPredict: (event) => signals.push(event.signal),
    };

    const a = controller.target(config),
      b = controller.target(config);

    a.ref(element);
    b.ref(element);
    controller.connect();
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const initial = controller.getDebugSnapshot().targets[0].rules.length;
    a.destroy();
    const remaining = controller.getDebugSnapshot().targets[0].rules.length;
    const aborted = signals.map((signal) => signal.aborted);
    b.ref(null);
    h.frame();
    const targets = controller.getDebugSnapshot().targets.length;
    controller.destroy();

    return { initial, remaining, aborted, targets };
  });

  expect(result).toEqual({ initial: 2, remaining: 1, aborted: [true, false], targets: 0 });
});

test('callback updates preserve episodes and invalid configuration leaves the current rule usable', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness,
      calls = [];

    const controller = window.createController({ debug: true });
    const options = { when: { type: 'intersects', withinMs: 120 }, onPredict: () => calls.push(1) };
    const target = controller.target(options);
    const element = h.element();
    target.ref(element);
    controller.connect();
    options.when.withinMs = 1;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    target.update({ when: { type: 'intersects', withinMs: 120 }, onPredict: () => calls.push(2) });
    h.frame(1025);
    const afterUpdate = [...calls];
    let rejected = false;

    try {
      target.update({ when: { type: 'intersects', withinMs: -1 }, onPredict() {} });
    } catch {
      rejected = true;
    }

    element.style.left = '1000px';
    h.pointer(1030, 30);
    h.frame();
    element.style.left = '100px';
    h.pointer(1040, 40);
    h.frame();
    const rules = controller.getDebugSnapshot().targets[0].rules.length;
    controller.destroy();

    return { afterUpdate, calls, rejected, rules };
  });

  expect(result).toEqual({ afterUpdate: [1], calls: [1, 2], rejected: true, rules: 1 });
});

test('abort handlers can reattach the same node without losing the replacement registration', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const controller = window.createController({ debug: true });
    const element = h.element();
    let replacement;

    const target = controller.target({
      when: { type: 'intersects', withinMs: 120 },
      onPredict(event) {
        event.signal.addEventListener(
          'abort',
          () => {
            replacement = controller.target({
              when: { type: 'intersects', withinMs: 120 },
              onPredict() {},
            });
            replacement.ref(element);
          },
          { once: true },
        );
      },
    });

    target.ref(element);
    controller.connect();
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    target.destroy();
    h.frame(1030);
    const snapshot = controller.getDebugSnapshot();
    const measured = replacement.getBounds() !== null;
    replacement.destroy();
    controller.destroy();

    return {
      targets: snapshot.targets.length,
      rules: snapshot.targets[0].rules.length,
      measured,
      frames: h.pendingFrames(),
    };
  });

  expect(result).toEqual({ targets: 1, rules: 1, measured: true, frames: 0 });
});

test('nested option changes from abort listeners create only the final subscription', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const controller = window.createController({ debug: true });

    const target = controller.target({
      when: { type: 'intersects', withinMs: 120 },
      onPredict(event) {
        event.signal.addEventListener(
          'abort',
          () =>
            target.update({
              when: { type: 'intersects', withinMs: 60 },
              onPredict() {},
            }),
          { once: true },
        );
      },
    });

    target.ref(h.element());
    controller.connect();
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    target.update({ when: { type: 'intersects', withinMs: 80 }, onPredict() {} });
    h.frame(1030);
    const rules = controller.getDebugSnapshot().targets[0].rules.map((rule) => rule.withinMs);
    controller.destroy();

    return rules;
  });

  expect(result).toEqual([60]);
});

test('an abort-side disconnect takes precedence over an interrupted options restart', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const controller = window.createController({ debug: true });

    const target = controller.target({
      when: { type: 'intersects', withinMs: 120 },
      onPredict({ signal }) {
        signal.addEventListener('abort', () => controller.disconnect(), { once: true });
      },
    });

    target.ref(h.element());
    controller.connect();
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    controller.updateOptions({ debug: true, horizonMs: 200 });
    const disconnected = controller.getDebugSnapshot() === null;
    const pending = h.pendingFrames();
    controller.connect();
    h.frame(1030);
    const restored = target.getBounds() !== null;
    controller.destroy();

    return { disconnected, pending, restored, remaining: h.pendingFrames() };
  });

  expect(result).toEqual({ disconnected: true, pending: 0, restored: true, remaining: 0 });
});

for (const replacement of ['inactive', 'foreign']) {
  test(`an ${replacement} document update leaves the live controller intact`, async ({ page }) => {
    const result = await page.evaluate((replacement) => {
      const h = window.harness;
      const controller = window.createController({ debug: true });
      const signals = [];

      const binding = controller.target({
        when: { type: 'intersects', withinMs: 120 },
        onPredict: ({ signal }) => signals.push(signal),
      });

      binding.ref(h.element());
      controller.connect();
      h.pointer(1000, 0);
      h.pointer(1020, 20);
      h.frame();
      const iframe = document.createElement('iframe');
      document.body.append(iframe);

      const nextDocument =
        replacement === 'inactive'
          ? document.implementation.createHTMLDocument('inactive')
          : iframe.contentDocument;

      let rejected = false;

      try {
        controller.updateOptions({ document: nextDocument, debug: true });
      } catch {
        rejected = true;
      }

      h.pointer(1040, 40);
      h.frame();
      const preserved = signals.length === 1 && !signals[0].aborted;
      const measured = binding.getBounds() !== null;
      const foreignOverlays = iframe.contentDocument.querySelectorAll('[data-hasta-debug]').length;
      controller.destroy();
      iframe.remove();

      return { rejected, preserved, measured, foreignOverlays, pending: h.pendingFrames() };
    }, replacement);

    expect(result).toEqual({
      rejected: true,
      preserved: true,
      measured: true,
      foreignOverlays: 0,
      pending: 0,
    });
  });
}

for (const shared of [false, true]) {
  for (const action of ['replace', 'remount', 'restore']) {
    test(`ref ${action} survives an abort-side update with shared=${shared}`, async ({ page }) => {
      const result = await page.evaluate(
        ({ shared, action }) => {
          const h = window.harness;
          const controller = window.createController({ debug: true });
          const original = h.element();
          const replacement = h.element({ x: 200 });
          let updated = false;
          const calls = [];

          const target = controller.target({
            when: () => true,
            onPredict(event) {
              event.signal.addEventListener(
                'abort',
                () => {
                  target.update({ when: () => true, onPredict: () => calls.push('updated') });
                  updated = true;

                  if (action === 'restore') {
                    target.ref(original);
                  }
                },
                { once: true },
              );
            },
          });

          target.ref(original);

          if (shared) {
            controller.target({ when: () => true, onPredict() {} }).ref(original);
          }

          controller.connect();
          h.pointer(1000, 0);
          h.pointer(1020, 20);
          h.frame();
          target.ref(action === 'remount' ? null : replacement);

          if (action === 'remount') {
            target.ref(original);
          }

          h.pointer(1040, 0);
          h.pointer(1060, 20);
          h.frame();
          const bounds = target.getBounds()?.rect.minX;
          const snapshot = controller.getDebugSnapshot();
          const rules = snapshot.targets.reduce((count, item) => count + item.rules.length, 0);
          controller.destroy();

          return { updated, calls, bounds, rules, frames: h.pendingFrames() };
        },
        { shared, action },
      );

      expect(result).toEqual({
        updated: true,
        calls: ['updated'],
        bounds: action === 'replace' ? 200 : 100,
        rules: shared ? 2 : 1,
        frames: 0,
      });
    });
  }
}

for (const initial of [true, {}, { samples: false }]) {
  test(`debug sample trails can be enabled and disabled from ${JSON.stringify(initial)}`, async ({
    page,
  }) => {
    const result = await page.evaluate((initial) => {
      const h = window.harness;
      const controller = window.createController({ debug: initial });
      controller.target({ when: () => true, onPredict() {} }).ref(h.element());
      controller.connect();
      h.pointer(1000, 0);
      h.pointer(1020, 20);
      h.frame();
      const host = document.querySelector('[data-hasta-debug]');
      const trail = () => host.shadowRoot.querySelector('[data-hasta-samples]') !== null;
      const states = [trail()];
      controller.updateOptions({ debug: { samples: true } });
      states.push(trail());
      controller.updateOptions({ debug: true });
      states.push(trail());
      controller.updateOptions({ debug: { samples: true } });
      states.push(trail());
      controller.updateOptions({ debug: { samples: false } });
      states.push(trail());
      const sameHost = host === document.querySelector('[data-hasta-debug]');
      controller.destroy();

      return { states, sameHost, frames: h.pendingFrames() };
    }, initial);

    expect(result).toEqual({
      states: [false, true, false, true, false],
      sameHost: true,
      frames: 0,
    });
  });
}
