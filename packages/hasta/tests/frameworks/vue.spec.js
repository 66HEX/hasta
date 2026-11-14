import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/vue.html');
  await page.waitForFunction(() => window.vueHarness);
  await page.evaluate(() => window.vueHarness.frame());
});

test('Vue mounts one engine and updates callback closures without restarting the current episode', async ({
  page,
}) => {
  await expect(page.locator('[data-hasta-debug]')).toHaveCount(1);

  const result = await page.evaluate(async () => {
    const f = window.vueHarness;
    f.pointer(1000, 0);
    f.pointer(1020, 20);
    f.frame();
    await f.change({ callbackVersion: 2 });
    f.frame(1025);
    const unchanged = f.state();
    const element = document.querySelector('[data-testid="vue-target"]');
    const originalLeft = element.style.left;
    element.style.left = '1000px';
    f.pointer(1030, 30);
    f.frame();
    element.style.left = originalLeft;
    f.pointer(1040, 40);
    f.frame();

    return { unchanged, updated: f.state() };
  });

  expect(result.unchanged.events).toEqual([{ version: 1, etaMs: 80, aborted: false }]);
  expect(result.unchanged.snapshot.targets).toHaveLength(1);
  expect(result.updated.events).toEqual([
    { version: 1, etaMs: 80, aborted: true },
    { version: 2, etaMs: 60, aborted: false },
  ]);
});

test('Vue reactive conditions cancel the old rule and apply new timing', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = window.vueHarness;
    f.pointer(1000, 0);
    f.pointer(1020, 20);
    f.frame();
    await f.change({ withinMs: 30 });
    f.frame(1021);
    const short = f.state();
    await f.change({ withinMs: 120, marginPx: 10 });
    f.frame(1040);

    return { short, expanded: f.state() };
  });

  expect(result.short.events).toEqual([{ version: 1, etaMs: 80, aborted: true }]);
  expect(result.short.snapshot.targets[0].rules[0].withinMs).toBe(30);
  expect(result.expanded.events.at(-1)).toEqual({ version: 1, etaMs: 50, aborted: false });
  expect(result.expanded.snapshot.targets[0].rules).toHaveLength(1);
});

test('Vue ref replacement and conditional targets remove the previous registration', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const f = window.vueHarness;
    f.pointer(1000, 0);
    f.pointer(1020, 20);
    f.frame();
    const original = document.querySelector('[data-testid="vue-target"]');
    await f.change({ targetVersion: 1 });
    f.frame(1030);
    const replaced = f.state();
    const replacement = document.querySelector('[data-testid="vue-target"]');
    await f.change({ showTarget: false });
    f.frame(1040);
    const hidden = f.state();
    await f.change({ showTarget: true });
    f.frame(1050);

    return { replaced, hidden, restored: f.state(), differentNode: replacement !== original };
  });

  expect(result.differentNode).toBe(true);
  expect(result.replaced.events[0].aborted).toBe(true);
  expect(result.replaced.snapshot.targets).toHaveLength(1);
  expect(result.hidden.snapshot.targets).toHaveLength(0);
  expect(result.hidden.bounds).toBeNull();
  expect(result.restored.snapshot.targets).toHaveLength(1);
  expect(result.restored.bounds.rect.minX).toBe(100);
});

test('Vue KeepAlive disconnects an owner and requires fresh samples on activation', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const f = window.vueHarness;
    f.pointer(1000, 0);
    f.pointer(1020, 20);
    f.frame();
    await f.change({ ownerActive: false });

    const inactive = {
      ...f.state(),
      hosts: document.querySelectorAll('[data-hasta-debug]').length,
    };

    await f.change({ ownerActive: true });
    f.frame(1030);
    const restored = f.state();
    f.pointer(1040, 0);
    f.frame();
    const warming = f.state();
    f.pointer(1060, 20);
    f.frame();

    return { inactive, restored, warming, active: f.state() };
  });

  expect(result.inactive.hosts).toBe(0);
  expect(result.inactive.pendingFrames).toBe(0);
  expect(result.inactive.events[0].aborted).toBe(true);
  expect(result.restored.snapshot.targets).toHaveLength(1);
  expect(result.restored.snapshot.forecast).toBeNull();
  expect(result.warming.events).toHaveLength(1);
  expect(result.active.events).toHaveLength(2);
  await expect(page.locator('[data-hasta-debug]')).toHaveCount(1);
});

test('Vue cached child detaches its target while an external owner stays connected', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const f = window.vueHarness;
    f.pointer(1000, 0);
    f.pointer(1020, 20);
    f.frame();
    await f.change({ targetActive: false });
    f.frame(1030);
    const inactive = f.state();
    await f.change({ callbackVersion: 3, marginPx: 15 });
    await f.change({ targetActive: true });
    f.frame(1040);
    f.pointer(1050, 0);
    f.pointer(1070, 20);
    f.frame();

    return { inactive, active: f.state() };
  });

  expect(result.inactive.snapshot.targets).toHaveLength(0);
  expect(result.inactive.events[0].aborted).toBe(true);
  expect(result.active.snapshot.targets).toHaveLength(1);
  expect(result.active.snapshot.targets[0].rules[0].marginPx).toBe(15);
  expect(result.active.events.at(-1)).toEqual({ version: 3, etaMs: 65, aborted: false });
  await expect(page.locator('[data-hasta-debug]')).toHaveCount(1);
});

test('Vue unmount clears resources and remount creates only one live engine', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const f = window.vueHarness;
    f.pointer(1000, 0);
    f.pointer(1020, 20);
    f.frame();
    await f.change({ mounted: false });

    const removed = {
      ...f.state(),
      hosts: document.querySelectorAll('[data-hasta-debug]').length,
    };

    f.pointer(1030, 30);
    f.frame();
    await f.change({ mounted: true });
    f.frame(1040);
    f.pointer(1050, 0);
    f.pointer(1070, 20);
    f.frame();
    const remounted = f.state();
    f.destroy();

    return {
      removed,
      remounted,
      finalFrames: f.state().pendingFrames,
      finalHosts: document.querySelectorAll('[data-hasta-debug]').length,
    };
  });

  expect(result.removed.hosts).toBe(0);
  expect(result.removed.pendingFrames).toBe(0);
  expect(result.removed.events[0].aborted).toBe(true);
  expect(result.remounted.snapshot.targets).toHaveLength(1);
  expect(result.remounted.events).toHaveLength(2);
  expect(result.finalFrames).toBe(0);
  expect(result.finalHosts).toBe(0);
});

test('Vue reactive engine options toggle debug and preserve mounted target refs', async ({
  page,
}) => {
  await page.evaluate(async () => {
    await window.vueHarness.change({ debug: false });
    window.vueHarness.frame();
  });
  await expect(page.locator('[data-hasta-debug]')).toHaveCount(0);

  const result = await page.evaluate(async () => {
    const f = window.vueHarness;
    await f.change({ debug: true, horizonMs: 80 });
    f.frame(1030);

    return f.state();
  });

  expect(result.snapshot.horizonMs).toBe(80);
  expect(result.snapshot.targets).toHaveLength(1);
  expect(result.bounds.rect.minX).toBe(100);
  await expect(page.locator('[data-hasta-debug]')).toHaveCount(1);
});

test('Vue rejects component or SVG refs and use outside setup without disturbing the live target', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const errors = window.vueHarness.invalidUsage();

    return { errors, state: window.vueHarness.state() };
  });

  expect(result.errors).toHaveLength(3);
  expect(result.errors[0]).toContain('HTMLElement');
  expect(result.errors[1]).toContain('HTMLElement');
  expect(result.errors[2]).toContain('setup()');
  expect(result.state.snapshot.targets).toHaveLength(1);
  expect(result.state.bounds.rect.minX).toBe(100);
  await expect(page.locator('[data-hasta-debug]')).toHaveCount(1);
});

test('Vue nested KeepAlive applies inactive options without resurrecting cached targets', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const f = window.vueHarness;
    const cycles = [];

    for (let cycle = 0; cycle < 10; cycle++) {
      const time = 1000 + cycle * 200;
      f.pointer(time, 0);
      f.pointer(time + 20, 20);
      f.frame();
      await f.change({ ownerActive: false, targetActive: false });
      await f.change({
        horizonMs: 140 + cycle,
        marginPx: cycle + 1,
        callbackVersion: cycle + 2,
        targetVersion: cycle + 1,
      });
      const hidden = f.state();
      const hiddenHosts = document.querySelectorAll('[data-hasta-debug]').length;
      await f.change({ ownerActive: true });
      f.frame(time + 30);
      const ownerOnly = f.state();
      await f.change({ showTarget: false, targetActive: true });
      f.frame(time + 40);
      const absent = f.state();
      await f.change({ showTarget: true });
      f.frame(time + 50);
      const restored = f.state();
      cycles.push({
        hidden: hidden.snapshot,
        hiddenHosts,
        hiddenFrames: hidden.pendingFrames,
        oldAborted: hidden.events.every((event) => event.aborted),
        ownerTargets: ownerOnly.snapshot.targets.length,
        absentTargets: absent.snapshot.targets.length,
        restoredTargets: restored.snapshot.targets.length,
        margin: restored.snapshot.targets[0].rules[0].marginPx,
        horizon: restored.snapshot.horizonMs,
        count: restored.events.length,
      });
    }

    f.pointer(3100, 0);
    f.pointer(3120, 20);
    f.frame();
    const final = f.state();
    f.destroy();

    return { cycles, final, frames: f.state().pendingFrames };
  });

  expect(result.cycles).toEqual(
    Array.from({ length: 10 }, (_, index) => ({
      hidden: null,
      hiddenHosts: 0,
      hiddenFrames: 0,
      oldAborted: true,
      ownerTargets: 0,
      absentTargets: 0,
      restoredTargets: 1,
      margin: index + 1,
      horizon: 140 + index,
      count: index + 1,
    })),
  );
  expect(result.final.events.at(-1)).toEqual({ version: 11, etaMs: 70, aborted: false });
  expect(result.final.errors).toEqual([]);
  expect(result.frames).toBe(0);
});

for (const inactive of [false, true]) {
  test(`Vue unmount discards queued option updates with inactive=${inactive}`, async ({ page }) => {
    const result = await page.evaluate(async (inactive) => {
      const f = window.vueHarness;
      f.pointer(1000, 0);
      f.pointer(1020, 20);
      f.frame();

      if (inactive) {
        await f.change({ ownerActive: false });
      }

      await f.change({ mounted: false, horizonMs: 60, withinMs: 60, callbackVersion: 2 });
      const removed = f.state();
      await f.change({ ownerActive: true, mounted: true, withinMs: 160 });
      f.pointer(1200, 0);
      f.pointer(1220, 20);
      f.frame();
      const restored = f.state();
      f.destroy();

      return { removed, restored, frames: f.state().pendingFrames };
    }, inactive);

    expect(result.removed.errors).toEqual([]);
    expect(result.removed.snapshot).toBeNull();
    expect(result.removed.pendingFrames).toBe(0);
    expect(result.removed.events[0].aborted).toBe(true);
    expect(result.restored.errors).toEqual([]);
    expect(result.restored.events.at(-1)).toEqual({ version: 2, etaMs: 80, aborted: false });
    expect(result.restored.snapshot.targets).toHaveLength(1);
    expect(result.frames).toBe(0);
  });
}

test('Vue rejects invalid reactive options without losing a live binding and recovers', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const f = window.vueHarness;
    f.pointer(1000, 0);
    f.pointer(1020, 20);
    f.frame();
    await f.change({ horizonMs: 0, withinMs: 0 });
    f.frame(1021);
    const rejected = f.state();
    await f.change({ horizonMs: 80, withinMs: 120, callbackVersion: 2, marginPx: 10 });
    f.pointer(1040, 0);
    f.pointer(1060, 20);
    f.frame();
    const restored = f.state();
    f.destroy();

    return { rejected, restored, frames: f.state().pendingFrames };
  });

  expect(result.rejected.errors).toHaveLength(2);
  expect(result.rejected.events).toEqual([{ version: 1, etaMs: 80, aborted: false }]);
  expect(result.rejected.snapshot.targets[0].rules[0].withinMs).toBe(120);
  expect(result.restored.events.at(-1)).toEqual({ version: 2, etaMs: 70, aborted: false });
  expect(result.restored.snapshot.horizonMs).toBe(120);
  expect(result.restored.snapshot.targets).toHaveLength(1);
  expect(result.frames).toBe(0);
});

test('Vue changing subscription policies and sample expiry honors the latest configuration', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const f = window.vueHarness;
    await f.change({ once: true, stableForMs: 20, maxSampleAgeMs: 200 });
    f.pointer(1000, 0);
    f.pointer(1020, 20);
    f.frame();
    f.frame(1039);
    const warming = f.state().events.length;
    f.frame(1040);
    const idleStable = f.state().events.length;
    f.pointer(1040, 40);
    f.frame();
    f.frame(1120);
    const stillLive = f.state().events[0].aborted;
    f.frame(1240);
    const expired = f.state().events[0].aborted;
    f.pointer(1240, 0);
    f.pointer(1260, 20);
    f.frame();
    f.frame(1280);
    const once = f.state().events.length;
    await f.change({ once: false, stableForMs: 0, cooldownMs: 30, callbackVersion: 2 });
    f.frame(1280);
    f.pointer(1290, 0);
    f.frame();
    f.pointer(1300, 20);
    f.frame();
    const cooling = f.state().events.length;
    f.frame(1310);
    const idleCooldown = f.state().events.length;
    f.pointer(1311, 31);
    f.frame();
    const final = f.state();
    f.destroy();

    return { warming, idleStable, stillLive, expired, once, cooling, idleCooldown, final };
  });

  expect(result.warming).toBe(0);
  expect(result.idleStable).toBe(0);
  expect(result.stillLive).toBe(false);
  expect(result.expired).toBe(true);
  expect(result.once).toBe(1);
  expect(result.cooling).toBe(2);
  expect(result.idleCooldown).toBe(2);
  expect(result.final.events.map((event) => event.version)).toEqual([1, 2, 2]);
  expect(result.final.snapshot.targets[0].rules).toHaveLength(1);
  expect(result.final.errors).toEqual([]);
});
