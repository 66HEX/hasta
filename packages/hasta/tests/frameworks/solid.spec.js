import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

import { expect, test } from '@playwright/test';
import { createComponent } from 'solid-js';
import { generateHydrationScript, renderToString } from 'solid-js/web';
import { build } from 'vite';
import solid from 'vite-plugin-solid';

let serverDirectory;
let serverMarkup;
let hydrationScript;
let browserErrors = [];

test.beforeAll(async () => {
  const packageRoot = fileURLToPath(new URL('../..', import.meta.url));
  serverDirectory = await mkdtemp(join(packageRoot, '.solid-hydration-'));
  await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [solid({ ssr: true })],
    build: {
      ssr: fileURLToPath(new URL('./solid-ssr.tsx', import.meta.url)),
      outDir: serverDirectory,
      emptyOutDir: true,
    },
  });

  const { default: Component } = await import(
    pathToFileURL(join(serverDirectory, 'solid-ssr.js')).href
  );

  serverMarkup = renderToString(() => createComponent(Component, {}));
  hydrationScript = generateHydrationScript()
    .replace(/^<script[^>]*>/u, '')
    .replace(/<\/script>[\s\S]*$/u, '');
});

test.afterAll(async () => {
  if (serverDirectory) {
    await rm(serverDirectory, { recursive: true, force: true });
  }
});

test.beforeEach(async ({ page }) => {
  browserErrors = [];
  page.on('pageerror', (error) => browserErrors.push(error.message));
  await page.goto('/solid.html');
  await page.waitForFunction(() => window.solidHarness);
});

test.afterEach(() => {
  expect(browserErrors).toEqual([]);
});

test('Solid owns one engine per controller and preserves episodes across reactive updates', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const first = h.state();
    h.update({ version: 2 });
    h.frame(1025);
    const unchanged = h.state();
    const element = document.querySelector('[data-testid="solid-target"]');
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

  expect(result.hosts).toBe(2);
  expect(result.first.snapshot.targets).toHaveLength(1);
  expect(result.first.events).toEqual([{ version: 1, etaMs: 80, aborted: false }]);
  expect(result.unchanged.events).toEqual(result.first.events);
  expect(result.next.events).toEqual([
    { version: 1, etaMs: 80, aborted: true },
    { version: 2, etaMs: 60, aborted: false },
  ]);
});

test('Solid target configuration updates replace the rule without replacing its DOM node', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
    const element = document.querySelector('[data-testid="solid-target"]');
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
      sameNode: element === document.querySelector('[data-testid="solid-target"]'),
    };
  });

  expect(result.before.events).toEqual([]);
  expect(result.sameNode).toBe(true);
  expect(result.after.events).toEqual([{ version: 1, etaMs: 70, aborted: false }]);
  expect(result.after.snapshot.targets[0].rules).toHaveLength(1);
  expect(result.after.snapshot.targets[0].rules[0]).toMatchObject({ withinMs: 120, marginPx: 10 });
});

test('Solid conditional refs and node replacement remove stale registrations and signals', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const element = document.querySelector('[data-testid="solid-target"]');
    h.update({ targetKey: 1 });
    h.frame(1030);
    const replacement = h.state();
    const changedNode = element !== document.querySelector('[data-testid="solid-target"]');
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

test('Solid unmount removes overlay and scheduled work and a fresh mount remains usable', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
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
  expect(result.hosts).toBe(2);
  expect(result.remounted.events.at(-1)).toEqual({ version: 1, etaMs: 80, aborted: false });
});

test('Solid controller transfers and simultaneous options changes retain exactly one binding', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
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
      hosts: 2,
    })),
  );
  result.cycles.forEach((cycle, index) => {
    expect(cycle.current.etaMs).toBeCloseTo(80 - index, 10);
  });
  expect(result.frames).toBe(0);
});

test('Solid can switch condition types and replace subscription policies', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
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

test('Solid unmount and controller replacement isolate unfinished callbacks', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const h = window.solidHarness;
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

for (const method of ['pause', 'disconnect']) {
  test(`Solid ${method} cancels current work and requires fresh samples on resume`, async ({
    page,
  }) => {
    const result = await page.evaluate((method) => {
      const h = window.solidHarness;
      h.pointer(1000, 0);
      h.pointer(1020, 20);
      h.frame();
      h[method]();
      const stopped = h.state();
      h[method === 'pause' ? 'resume' : 'connect']();
      h.frame(1030);
      const fresh = h.state();
      h.pointer(1040, 0);
      h.frame();
      const warmup = h.state().events.length;
      h.pointer(1060, 20);
      h.frame();
      const resumed = h.state();
      h.mount(false);

      return { stopped, fresh, warmup, resumed, pending: h.state().pendingFrames };
    }, method);

    expect(result.stopped.events[0].aborted).toBe(true);
    expect(result.fresh.snapshot.targets).toHaveLength(1);
    expect(result.fresh.snapshot.forecast).toBeNull();
    expect(result.warmup).toBe(1);
    expect(result.resumed.events).toHaveLength(2);
    expect(result.resumed.events[1]).toEqual({ version: 1, etaMs: 80, aborted: false });
    expect(result.pending).toBe(0);
  });
}

test('Solid reactive engine options toggle debug, restart prediction, and preserve refs', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const element = document.querySelector('[data-testid="solid-target"]');
    h.update({ debug: false });
    const hidden = document.querySelectorAll('[data-hasta-debug]').length;
    h.update({ debug: true, horizonMs: 80, maxSampleAgeMs: 200 });
    h.frame(1030);
    const restarted = h.state();
    h.pointer(1040, 0);
    h.pointer(1060, 20);
    h.frame();
    h.frame(1160);
    const live = h.state().events.at(-1).aborted;
    h.frame(1260);
    const expired = h.state().events.at(-1).aborted;

    return {
      hidden,
      restarted,
      sameNode: element === document.querySelector('[data-testid="solid-target"]'),
      hosts: document.querySelectorAll('[data-hasta-debug]').length,
      live,
      expired,
    };
  });

  expect(result.hidden).toBe(0);
  expect(result.hosts).toBe(2);
  expect(result.sameNode).toBe(true);
  expect(result.restarted.snapshot.targets).toHaveLength(1);
  expect(result.restarted.snapshot.horizonMs).toBe(80);
  expect(result.restarted.snapshot.maxSampleAgeMs).toBe(200);
  expect(result.restarted.events[0].aborted).toBe(true);
  expect(result.live).toBe(false);
  expect(result.expired).toBe(true);
});

test('Solid rejects ownerless helpers, MathML refs, and invalid options while retaining the live rule', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const errors = h.invalidUsage();
    h.frame(1021);
    const rejected = h.state();
    h.update({ version: 2, marginPx: 10, horizonMs: 80 });
    h.pointer(1040, 0);
    h.pointer(1060, 20);
    h.frame();

    return { errors, rejected, restored: h.state() };
  });

  expect(result.errors).toHaveLength(5);
  expect(result.errors[0]).toMatch(/owner|component|root/iu);
  expect(result.errors[1]).toMatch(/owner|component|root/iu);
  expect(result.errors[2]).toContain('HTMLElement');
  expect(result.errors[3]).toContain('withinMs');
  expect(result.errors[4]).toContain('horizonMs');
  expect(result.rejected.events).toEqual([{ version: 1, etaMs: 80, aborted: false }]);
  expect(result.rejected.snapshot.targets[0].rules).toHaveLength(1);
  expect(result.restored.events.at(-1)).toEqual({ version: 2, etaMs: 70, aborted: false });
});

test('Solid repeated conditional DOM disposal keeps its owner alive and restores latest hidden options', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const result = await page.evaluate(() => {
    const h = window.solidHarness;
    const cycles = [];

    for (let cycle = 0; cycle < 10; cycle++) {
      const time = 1000 + cycle * 200;
      h.pointer(time, 0);
      h.pointer(time + 20, 20);
      h.frame();
      h.update({ visible: false });
      const hidden = h.state();
      h.update({ alternate: cycle % 2 === 1, version: cycle + 2, marginPx: cycle + 1 });
      h.frame(time + 30);
      const absent = h.state();
      h.update({ visible: true });
      h.frame(time + 40);
      const restored = h.state();
      cycles.push({
        hiddenTargets: hidden.owners,
        hiddenBounds: hidden.bounds,
        aborted: hidden.events.every((event) => event.aborted),
        absentTargets: absent.owners,
        owners: restored.owners,
        margin: restored.snapshot.targets[0].rules[0].marginPx,
        calls: restored.events.length,
      });
    }

    h.pointer(3100, 0);
    h.pointer(3120, 20);
    h.frame();
    const final = h.state();
    h.mount(false);

    return { cycles, final, frames: h.state().pendingFrames };
  });

  expect(errors).toEqual([]);
  expect(result.cycles).toEqual(
    Array.from({ length: 10 }, (_, index) => ({
      hiddenTargets: [0, 0],
      hiddenBounds: null,
      aborted: true,
      absentTargets: [0, 0],
      owners: index % 2 === 1 ? [0, 1] : [1, 0],
      margin: index + 1,
      calls: index + 1,
    })),
  );
  expect(result.final.events.at(-1)).toEqual({ version: 11, etaMs: 70, aborted: false });
  expect(result.frames).toBe(0);
});

test('Solid predicate replacement reevaluates without creating duplicate subscriptions', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
    h.update({ predicate: true, matches: false });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const missed = h.state().events.length;
    h.update({ matches: true, version: 2 });
    h.pointer(1040, 40);
    h.frame();
    const matched = h.state();
    h.update({ version: 3 });
    h.frame(1041);
    const unchanged = h.state().events.length;
    h.update({ matches: false });
    h.frame(1042);
    const aborted = h.state().events[0].aborted;
    h.update({ matches: true });
    h.pointer(1060, 60);
    h.frame();

    return { missed, matched, unchanged, aborted, final: h.state() };
  });

  expect(result.missed).toBe(0);
  expect(result.matched.events.map((event) => event.version)).toEqual([2]);
  expect(result.unchanged).toBe(1);
  expect(result.aborted).toBe(true);
  expect(result.final.events.map((event) => event.version)).toEqual([2, 3]);
  expect(result.final.snapshot.targets[0].rules).toHaveLength(1);
});

test('Solid hydrates server-rendered DOM, predicts, and releases hydrated resources', async ({
  page,
}) => {
  expect(serverMarkup).toContain('Solid SSR target');
  await page.addScriptTag({ content: hydrationScript });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  const result = await page.evaluate((markup) => {
    const h = window.solidHarness;
    const reused = h.hydrate(markup);
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const hydrated = h.state();
    const hosts = document.querySelectorAll('[data-hasta-debug]').length;
    h.mount(false);

    return {
      reused,
      hydrated,
      hosts,
      removed: h.state(),
      finalHosts: document.querySelectorAll('[data-hasta-debug]').length,
    };
  }, serverMarkup);

  expect(errors).toEqual([]);
  expect(result.reused).toBe(true);
  expect(result.hosts).toBe(1);
  expect(result.hydrated.snapshot.targets).toHaveLength(1);
  expect(result.hydrated.events).toEqual([{ version: 1, etaMs: 80, aborted: false }]);
  expect(result.removed.events[0].aborted).toBe(true);
  expect(result.removed.pendingFrames).toBe(0);
  expect(result.finalHosts).toBe(0);
});

test('Solid reads nested store fields and leaves abort listener signals outside adapter dependencies', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
    h.mount(false);
    const raw = h.rawFixture();
    raw.change({ withinMs: 30 });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const missed = raw.signals.length;
    raw.change({ withinMs: 120 });
    h.frame(1021);
    const matched = raw.signals.length;
    raw.change({ marginPx: 10 });
    const aborted = raw.signals[0].aborted;
    const reads = raw.reads();
    raw.noise(1);
    const unchanged = raw.reads() === reads;
    h.frame(1022);
    const final = raw.first.getDebugSnapshot();
    raw.destroy();

    return { missed, matched, aborted, unchanged, final, pending: h.state().pendingFrames };
  });

  expect(result.missed).toBe(0);
  expect(result.matched).toBe(1);
  expect(result.aborted).toBe(true);
  expect(result.unchanged).toBe(true);
  expect(result.final.targets[0].rules).toHaveLength(1);
  expect(result.final.targets[0].rules[0].marginPx).toBe(10);
  expect(result.pending).toBe(0);
});

test('Solid target destruction during an abort-side controller transfer cannot resurrect registration', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
    h.mount(false);
    const raw = h.rawFixture();
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    raw.abort(() => raw.target.destroy());
    raw.switch();
    raw.change({ marginPx: 10 });
    h.frame(1030);

    const targets = [raw.first, raw.second].map(
      (controller) => controller.getDebugSnapshot().targets.length,
    );

    raw.target.destroy();
    raw.destroy();

    return { targets, aborted: raw.signals[0].aborted, pending: h.state().pendingFrames };
  });

  expect(result).toEqual({ targets: [0, 0], aborted: true, pending: 0 });
});

test('Solid stale ref owner cleanup and abort-side reattachment preserve the latest element', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
    h.mount(false);
    const raw = h.rawFixture();
    const originalOwner = raw.ownedRef(raw.node);
    const replacement = raw.node.cloneNode(true);
    document.body.append(replacement);
    const replacementOwner = raw.ownedRef(replacement);
    originalOwner();
    h.frame();
    const preserved = raw.first.getDebugSnapshot().targets.length;
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    raw.abort(() => raw.target.ref(raw.node));
    replacementOwner();
    h.frame(1030);
    const rebound = raw.first.getDebugSnapshot().targets.length;
    const bounds = raw.target.getBounds();
    raw.destroy();
    replacement.remove();

    return { preserved, rebound, bounds, pending: h.state().pendingFrames };
  });

  expect(result.preserved).toBe(1);
  expect(result.rebound).toBe(1);
  expect(result.bounds.rect.minX).toBe(100);
  expect(result.pending).toBe(0);
});

test('Solid an abort-side controller change during ref replacement retains the new node and owner cleanup', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
    h.mount(false);
    const raw = h.rawFixture();
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const replacement = raw.node.cloneNode(true);
    replacement.style.left = '200px';
    document.body.append(replacement);
    raw.abort(() => raw.switch());
    const disposeReplacement = raw.ownedRef(replacement);
    h.frame(1030);

    const targets = [raw.first, raw.second].map(
      (controller) => controller.getDebugSnapshot().targets.length,
    );

    const bounds = raw.target.getBounds();
    disposeReplacement();

    const removed = [raw.first, raw.second].map(
      (controller) => controller.getDebugSnapshot().targets.length,
    );

    raw.destroy();
    replacement.remove();

    return { targets, bounds, removed, pending: h.state().pendingFrames };
  });

  expect(result.targets).toEqual([0, 1]);
  expect(result.bounds.rect.minX).toBe(200);
  expect(result.removed).toEqual([0, 0]);
  expect(result.pending).toBe(0);
});

test('Solid invalid reactive target and instance options preserve live registrations and recover', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.solidHarness;
    h.mount(false);
    const raw = h.rawFixture();
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const errors = [];

    for (const update of [
      () => raw.change({ withinMs: 0 }),
      () => raw.configure({ horizonMs: 0 }),
    ]) {
      try {
        update();
      } catch (error) {
        errors.push(error.message);
      }
    }

    const preserved = {
      aborted: raw.signals[0].aborted,
      targets: raw.first.getDebugSnapshot().targets.length,
    };

    raw.change({ withinMs: 120, marginPx: 10 });
    raw.configure({ horizonMs: 80, debug: { samples: true } });
    h.pointer(1040, 0);
    h.pointer(1060, 20);
    h.frame();
    const recovered = raw.first.getDebugSnapshot();
    raw.destroy();

    return { errors, preserved, recovered, pending: h.state().pendingFrames };
  });

  expect(result.errors).toHaveLength(2);
  expect(result.errors[0]).toContain('withinMs');
  expect(result.errors[1]).toContain('horizonMs');
  expect(result.preserved).toEqual({ aborted: false, targets: 1 });
  expect(result.recovered.maxSampleAgeMs).toBe(100);
  expect(result.recovered.targets[0].rules[0].marginPx).toBe(10);
  expect(result.recovered.samples).toHaveLength(2);
  expect(result.pending).toBe(0);
});
