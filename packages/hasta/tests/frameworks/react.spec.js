import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/react.html');
  await page.waitForFunction(() => window.reactHarness);
});

test('React StrictMode owns one engine and preserves episodes across ordinary rerenders', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.reactHarness;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const first = h.state();
    h.update({ version: 2 });
    h.frame(1025);
    const unchanged = h.state();
    const element = document.querySelector('[data-testid="target"]');
    const originalLeft = element.style.left;
    element.style.left = '1000px';
    h.pointer(1030, 30);
    h.frame();
    element.style.left = originalLeft;
    h.pointer(1040, 40);
    h.frame();

    return {
      first,
      unchanged,
      next: h.state(),
      hosts: document.querySelectorAll('[data-hasta-debug]').length,
    };
  });

  expect(result.hosts).toBe(1);
  expect(result.first.snapshot.targets).toHaveLength(1);
  expect(result.first.events).toEqual([{ version: 1, etaMs: 80, aborted: false }]);
  expect(result.unchanged.events).toEqual(result.first.events);
  expect(result.next.events).toEqual([
    { version: 1, etaMs: 80, aborted: true },
    { version: 2, etaMs: 60, aborted: false },
  ]);
});

test('React target configuration updates replace the rule without replacing its DOM node', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.reactHarness;
    const element = document.querySelector('[data-testid="target"]');
    h.update({ withinMs: 40 });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const before = h.state();
    h.update({ withinMs: 120, marginPx: 10 });
    h.frame(1020);

    return {
      before,
      after: h.state(),
      sameNode: element === document.querySelector('[data-testid="target"]'),
    };
  });

  expect(result.before.events).toEqual([]);
  expect(result.sameNode).toBe(true);
  expect(result.after.events).toEqual([{ version: 1, etaMs: 70, aborted: false }]);
  expect(result.after.snapshot.targets[0].rules).toHaveLength(1);
  expect(result.after.snapshot.targets[0].rules[0]).toMatchObject({ withinMs: 120, marginPx: 10 });
});

test('React conditional refs and node replacement remove stale registrations and signals', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.reactHarness;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const element = document.querySelector('[data-testid="target"]');
    h.update({ targetKey: 1 });
    h.frame(1030);
    const replacement = h.state();
    const changedNode = element !== document.querySelector('[data-testid="target"]');
    h.update({ visible: false });
    h.frame(1040);
    const hidden = h.state();
    h.update({ visible: true });
    h.pointer(1050, 0);
    h.pointer(1070, 20);
    h.frame();

    return { changedNode, replacement, hidden, restored: h.state() };
  });

  expect(result.changedNode).toBe(true);
  expect(result.replacement.snapshot.targets).toHaveLength(1);
  expect(result.replacement.events[0].aborted).toBe(true);
  expect(result.hidden.snapshot.targets).toHaveLength(0);
  expect(result.restored.snapshot.targets).toHaveLength(1);
  expect(result.restored.events.at(-1)).toMatchObject({ version: 1, aborted: false });
});

test('React unmount removes overlay and scheduled work and a fresh mount remains usable', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.reactHarness;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.mount(false);
    const unmounted = h.state();
    const hostsAfterUnmount = document.querySelectorAll('[data-hasta-debug]').length;
    h.mount();
    h.pointer(1030, 0);
    h.pointer(1050, 20);
    h.frame();

    return {
      unmounted,
      hostsAfterUnmount,
      remounted: h.state(),
      hosts: document.querySelectorAll('[data-hasta-debug]').length,
    };
  });

  expect(result.hostsAfterUnmount).toBe(0);
  expect(result.unmounted.snapshot).toBeNull();
  expect(result.unmounted.pendingFrames).toBe(0);
  expect(result.unmounted.events).toEqual([{ version: 1, etaMs: 80, aborted: true }]);
  expect(result.hosts).toBe(1);
  expect(result.remounted.events.at(-1)).toEqual({ version: 1, etaMs: 80, aborted: false });
});

test('React abandoned concurrent renders cannot replace the last committed callback', async ({
  page,
}) => {
  await page.evaluate(() => window.reactHarness.suspendVersion(99));
  await expect
    .poll(() => page.evaluate(() => window.reactHarness.state().attemptedVersions))
    .toContain(99);
  await expect(page.getByTestId('version')).toHaveText('1');

  const result = await page.evaluate(() => {
    const h = window.reactHarness;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const state = h.state();
    h.mount(false);

    return state;
  });

  expect(result.events).toEqual([{ version: 1, etaMs: 80, aborted: false }]);
});

for (const mode of ['activity', 'suspense']) {
  test(`React ${mode} hides and restores bindings with the latest options`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const result = await page.evaluate((mode) => {
      const h = window.reactHarness;
      const cycles = [];

      for (let cycle = 0; cycle < 8; cycle++) {
        const time = 1000 + cycle * 200;
        h.pointer(time, 0);
        h.pointer(time + 20, 20);
        h.frame();

        if (mode === 'activity') {
          h.mount(true, true);
        } else {
          h.update({ suspended: true });
        }

        const hidden = h.state();
        const hostsWhileHidden = document.querySelectorAll('[data-hasta-debug]').length;
        h.update({ version: cycle + 2, marginPx: cycle + 1, suspended: false });

        if (mode === 'activity') {
          h.mount();
        }

        h.frame(time + 30);
        cycles.push({
          hidden: {
            snapshot: hidden.snapshot,
            frames: hidden.pendingFrames,
            hosts: hostsWhileHidden,
          },
          restoredTargets: h.state().snapshot?.targets.length,
          margin: h.state().snapshot?.targets[0]?.rules[0]?.marginPx,
          calls: hidden.events.length,
          aborted: hidden.events.every((event) => event.aborted),
        });
      }

      h.pointer(2700, 0);
      h.pointer(2720, 20);
      h.frame();
      const final = h.state().events.at(-1);
      h.mount(false);

      return { cycles, final, frames: h.state().pendingFrames };
    }, mode);

    expect(errors).toEqual([]);
    expect(result.cycles).toEqual(
      Array.from({ length: 8 }, (_, index) => ({
        hidden: { snapshot: null, frames: 0, hosts: 0 },
        restoredTargets: 1,
        margin: index + 1,
        calls: index + 1,
        aborted: true,
      })),
    );
    expect(result.final).toEqual({ version: 9, etaMs: 72, aborted: false });
    expect(result.frames).toBe(0);
  });
}

test('React controller transfers and simultaneous options changes retain exactly one binding', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.reactHarness;
    const cycles = [];

    for (let cycle = 0; cycle < 20; cycle++) {
      const time = 1000 + cycle * 200;
      h.update({
        alternate: cycle % 2 === 1,
        version: cycle + 1,
        horizonMs: 120 + cycle,
        marginPx: cycle,
      });
      h.pointer(time, 0);
      h.pointer(time + 20, 20);
      h.frame();
      const state = h.state();
      cycles.push({
        count: state.events.length,
        current: state.events.at(-1),
        oldAborted: state.events.slice(0, -1).every((event) => event.aborted),
        targets: state.snapshot.targets.length,
        rules: state.snapshot.targets[0].rules.length,
        hosts: document.querySelectorAll('[data-hasta-debug]').length,
      });
    }

    h.mount(false);

    return { cycles, frames: h.state().pendingFrames };
  });

  expect(result.cycles).toEqual(
    Array.from({ length: 20 }, (_, index) => ({
      count: index + 1,
      current: { version: index + 1, etaMs: expect.any(Number), aborted: false },
      oldAborted: true,
      targets: 1,
      rules: 1,
      hosts: 1,
    })),
  );
  result.cycles.forEach((cycle, index) => {
    expect(cycle.current.etaMs).toBeCloseTo(80 - index, 10);
  });
  expect(result.frames).toBe(0);
});

test('React can switch condition types and replace subscription policies', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.reactHarness;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.update({ predicate: true, once: true, stableForMs: 20, version: 2 });
    h.frame(1021);
    h.frame(1040);
    const beforeStable = h.state().events.length;
    h.frame(1041);
    const idleStable = h.state().events.length;
    h.pointer(1042, 42);
    h.frame();
    const matched = h.state();
    h.pointer(1200, 0);
    h.pointer(1220, 20);
    h.frame();
    h.frame(1241);
    const once = h.state().events.length;
    h.update({ predicate: false, once: false, stableForMs: 0, version: 3, cooldownMs: 30 });
    h.frame(1242);
    h.pointer(1250, 0);
    h.frame();
    h.pointer(1260, 20);
    h.frame();
    const cooling = h.state().events.length;
    h.frame(1272);
    const idleCooldown = h.state().events.length;
    h.pointer(1273, 33);
    h.frame();
    const final = h.state();
    h.mount(false);

    return { beforeStable, idleStable, matched, once, cooling, idleCooldown, final };
  });

  expect(result.beforeStable).toBe(1);
  expect(result.idleStable).toBe(1);
  expect(result.matched.events.map((event) => event.version)).toEqual([1, 2]);
  expect(result.matched.events[0].aborted).toBe(true);
  expect(result.matched.snapshot.targets[0].rules[0].kind).toBe('predicate');
  expect(result.once).toBe(2);
  expect(result.cooling).toBe(3);
  expect(result.idleCooldown).toBe(3);
  expect(result.final.events.map((event) => event.version)).toEqual([1, 2, 3, 3]);
  expect(result.final.snapshot.targets[0].rules).toHaveLength(1);
});

test('React unmount and controller replacement isolate unfinished callbacks', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.reactHarness;
    h.update({ asyncCallback: true });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.update({ alternate: true, version: 2 });
    h.pointer(1040, 0);
    h.pointer(1060, 20);
    h.frame();
    const transferred = h.state();
    h.mount(false);
    h.settle();
    await Promise.resolve();
    h.mount();
    h.pointer(1200, 0);
    h.pointer(1220, 20);
    h.frame();
    const restored = h.state();
    h.mount(false);

    return { transferred, restored, frames: h.state().pendingFrames };
  });

  expect(result.transferred.events).toEqual([
    { version: 1, etaMs: 80, aborted: true },
    { version: 2, etaMs: 80, aborted: false },
  ]);
  expect(result.restored.events.map((event) => event.aborted)).toEqual([true, true, false]);
  expect(result.restored.snapshot.targets).toHaveLength(1);
  expect(result.frames).toBe(0);
});
