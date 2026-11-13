import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/svelte.html');
  await page.waitForFunction(() => window.svelteReady);
});

test('Svelte action uses the shared engine and callback updates preserve the active episode', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.svelteHarness;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const initial = h.read();
    await h.configure({ callbackVersion: 2 });
    h.frame(1030);
    const sameEpisode = h.read();
    const element = document.querySelector('[data-testid="svelte-target"]');
    const originalLeft = element.style.left;
    element.style.left = '1000px';
    h.pointer(1040, 40);
    h.frame();
    element.style.left = originalLeft;
    h.pointer(1050, 50);
    h.frame();

    return {
      initial: initial.calls,
      sameEpisode: sameEpisode.calls,
      calls: h.read().calls,
      aborted: h.read().aborted,
      targets: h.read().snapshot.targets.length,
    };
  });

  expect(result).toEqual({
    initial: [{ version: 1, etaMs: 80 }],
    sameEpisode: [{ version: 1, etaMs: 80 }],
    calls: [
      { version: 1, etaMs: 80 },
      { version: 2, etaMs: 50 },
    ],
    aborted: 1,
    targets: 1,
  });
});

test('Svelte action updates geometry conditions, replaces nodes, and switches controller ownership', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.svelteHarness;
    await h.configure({ horizon: 25 });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const short = h.read().calls.length;
    await h.configure({ horizon: 120 });
    h.frame();
    const reached = h.read().calls.length;
    await h.configure({ replace: true });
    h.pointer(1030, 0);
    h.pointer(1050, 20);
    h.frame();
    const replaced = h.read();
    await h.configure({ switchController: true });
    h.pointer(1060, 0);
    h.pointer(1080, 20);
    h.frame();
    const switched = h.read();
    await h.configure({ show: false });
    h.frame();
    const removed = h.read();

    return {
      short,
      reached,
      replaced: replaced.snapshot.targets.length,
      oldTargets: switched.snapshot.targets.length,
      newTargets: switched.alternateSnapshot.targets.length,
      removedTargets: removed.alternateSnapshot.targets.length,
      aborted: removed.aborted,
    };
  });

  expect(result).toEqual({
    short: 0,
    reached: 1,
    replaced: 1,
    oldTargets: 0,
    newTargets: 1,
    removedTargets: 0,
    aborted: 3,
  });
});

test('Svelte attachment tracks reactive options through the official action bridge', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.svelteHarness;
    await h.configure({ attachment: true, horizon: 25 });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const missed = h.read().calls.length;
    await h.configure({ horizon: 120, callbackVersion: 3 });
    h.frame();
    const hit = h.read();
    await h.configure({ callbackVersion: 4 });
    h.frame(1030);

    return {
      missed,
      calls: hit.calls,
      afterCallbackUpdate: h.read().calls,
      targets: h.read().snapshot.targets.length,
    };
  });

  expect(result).toEqual({
    missed: 0,
    calls: [{ version: 3, etaMs: 80 }],
    afterCallbackUpdate: [{ version: 3, etaMs: 80 }],
    targets: 1,
  });
});

test('Svelte instance updates, pause, and unmount remove overlays and queued work', async ({
  page,
}) => {
  await expect(page.locator('[data-hasta-debug]')).toHaveCount(2);
  await page.evaluate(async () => {
    const h = window.svelteHarness;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    h.pause();
  });
  await page.getByTestId('svelte-target').click();
  await expect(page.getByTestId('svelte-clicks')).toHaveText('1');

  const result = await page.evaluate(async () => {
    const h = window.svelteHarness;
    const paused = h.read().snapshot.status;
    h.resume();
    h.pointer(1040, 20);
    h.frame();
    const afterWarmup = h.read().calls.length;
    await h.configure({ debug: false });
    const disabledHosts = document.querySelectorAll('[data-hasta-debug]').length;
    await h.configure({ debug: true });
    const restoredHosts = document.querySelectorAll('[data-hasta-debug]').length;
    await h.unmount();
    h.frame(1060);

    const destroyed = {
      hosts: document.querySelectorAll('[data-hasta-debug]').length,
      pending: h.pending(),
    };

    h.mount();
    h.frame();
    const remounted = h.read().snapshot.targets.length;
    await h.unmount();

    return {
      paused,
      afterWarmup,
      disabledHosts,
      restoredHosts,
      destroyed,
      remounted,
      finalPending: h.pending(),
    };
  });

  expect(result).toEqual({
    paused: 'paused',
    afterWarmup: 1,
    disabledHosts: 0,
    restoredHosts: 2,
    destroyed: { hosts: 0, pending: 0 },
    remounted: 1,
    finalPending: 0,
  });
});

for (const attachment of [false, true]) {
  test(`Svelte ${attachment ? 'attachment' : 'action'} observes in-place options and ownership changes`, async ({
    page,
  }) => {
    const result = await page.evaluate(async (attachment) => {
      const h = window.svelteHarness;
      await h.configure({ mutable: true, attachment, horizon: 25 });
      h.pointer(1000, 0);
      h.pointer(1020, 20);
      h.frame();
      const missed = h.read().calls.length;
      await h.configure({ horizon: 120 });
      h.frame();
      const hit = h.read().calls;
      await h.configure({ callbackVersion: 2 });
      h.frame(1025);
      const unchanged = h.read().calls.length;
      const element = document.querySelector('[data-testid="svelte-target"]');
      const originalLeft = element.style.left;
      element.style.left = '1000px';
      h.pointer(1030, 30);
      h.frame();
      element.style.left = originalLeft;
      h.pointer(1040, 40);
      h.frame();
      const updated = h.read().calls;
      await h.configure({ switchController: true });
      h.pointer(1060, 0);
      h.pointer(1080, 20);
      h.frame();
      const switched = h.read();
      await h.configure({ show: false });
      const detached = h.read();
      await h.unmount();

      return {
        missed,
        hit,
        unchanged,
        updated,
        switched: [switched.snapshot.targets.length, switched.alternateSnapshot.targets.length],
        detached: [detached.snapshot.targets.length, detached.alternateSnapshot.targets.length],
        pending: h.pending(),
      };
    }, attachment);

    expect(result).toEqual({
      missed: 0,
      hit: [{ version: 1, etaMs: 80 }],
      unchanged: 1,
      updated: [
        { version: 1, etaMs: 80 },
        { version: 2, etaMs: 60 },
      ],
      switched: [0, 1],
      detached: [0, 0],
      pending: 0,
    });
  });
}

for (const reentrant of [false, true]) {
  test(`Svelte action cleanup cannot be resurrected by ${reentrant ? 'an abort listener' : 'a late update'}`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));

    const result = await page.evaluate(async (reentrant) => {
      const h = window.svelteHarness;
      await h.unmount();
      const owner = h.createController({ debug: true });
      const replacement = h.createController({ debug: true });
      const element = document.createElement('button');
      element.style.cssText = 'position:absolute;left:100px;top:100px;width:20px;height:20px';
      document.body.append(element);
      owner.connect();
      replacement.connect();
      const next = { hasta: replacement, when: () => true, onPredict() {} };

      const action = h.action(element, {
        hasta: owner,
        when: () => true,
        onPredict({ signal }) {
          if (reentrant) {
            signal.addEventListener('abort', () => action.update(next), { once: true });
          }
        },
      });

      h.pointer(1000, 0);
      h.pointer(1020, 20);
      h.frame();
      action.destroy();

      if (!reentrant) {
        action.update(next);
      }

      h.frame(1040);

      const targets = [owner, replacement].map(
        (controller) => controller.getDebugSnapshot().targets.length,
      );

      action.destroy();
      owner.destroy();
      replacement.destroy();
      element.remove();

      return { targets, pending: h.pending() };
    }, reentrant);

    expect(result).toEqual({ targets: [0, 0], pending: 0 });
    expect(errors).toEqual([]);
  });
}

for (const attachment of [false, true]) {
  test(`Svelte ${attachment ? 'attachment' : 'action'} remounts with the latest hidden options`, async ({
    page,
  }) => {
    const result = await page.evaluate(async (attachment) => {
      const h = window.svelteHarness;
      const cycles = [];

      for (let cycle = 0; cycle < 5; cycle++) {
        await h.configure({ show: false, attachment, mutable: true });
        await h.configure({
          horizon: 25,
          callbackVersion: cycle + 2,
          switchController: cycle % 2 === 1,
        });
        await h.configure({ show: true });
        h.pointer(1000 + cycle * 100, 0);
        h.pointer(1020 + cycle * 100, 20);
        h.frame();
        const missed = h.read().calls.length;
        await h.configure({ horizon: 120 });
        h.frame();
        const active = h.read();
        await h.configure({ show: false });
        const hidden = h.read();
        cycles.push({
          missed,
          calls: active.calls.length,
          version: active.calls.at(-1)?.version,
          active: [active.snapshot.targets.length, active.alternateSnapshot.targets.length],
          hidden: [hidden.snapshot.targets.length, hidden.alternateSnapshot.targets.length],
          aborted: hidden.aborted,
        });
      }

      await h.unmount();

      return { cycles, pending: h.pending() };
    }, attachment);

    expect(result).toEqual({
      cycles: Array.from({ length: 5 }, (_, index) => ({
        missed: index,
        calls: index + 1,
        version: index + 2,
        active: index % 2 === 1 ? [0, 1] : [1, 0],
        hidden: [0, 0],
        aborted: index + 1,
      })),
      pending: 0,
    });
  });
}

test('Svelte action keeps its old registration when replacement options are invalid', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.svelteHarness;
    await h.unmount();
    const owner = h.createController({ debug: true });
    const replacement = h.createController({ debug: true });
    const element = document.createElement('button');
    element.style.cssText = 'position:absolute;left:100px;top:100px;width:20px;height:20px';
    document.body.append(element);
    owner.connect();
    replacement.connect();
    const signals = [];

    const action = h.action(element, {
      hasta: owner,
      when: () => true,
      onPredict: ({ signal }) => signals.push(signal),
    });

    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    let rejected = false;

    try {
      action.update({
        hasta: replacement,
        when: { type: 'intersects', withinMs: 0 },
        onPredict() {},
      });
    } catch {
      rejected = true;
    }

    h.frame(1030);

    const preserved = {
      targets: [owner, replacement].map(
        (controller) => controller.getDebugSnapshot().targets.length,
      ),
      aborted: signals[0].aborted,
    };

    action.update({ hasta: replacement, when: () => true, onPredict() {} });
    h.pointer(1040, 0);
    h.pointer(1060, 20);
    h.frame();

    const swapped = {
      targets: [owner, replacement].map(
        (controller) => controller.getDebugSnapshot().targets.length,
      ),
      aborted: signals[0].aborted,
    };

    action.destroy();
    owner.destroy();
    replacement.destroy();
    element.remove();

    return { rejected, preserved, swapped, pending: h.pending() };
  });

  expect(result).toEqual({
    rejected: true,
    preserved: { targets: [1, 0], aborted: false },
    swapped: { targets: [0, 1], aborted: true },
    pending: 0,
  });
});
