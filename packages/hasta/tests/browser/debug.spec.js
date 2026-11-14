import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

test('debug is opt-in and toggling it preserves the callback episode', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta();
    let calls = 0;
    hasta.track(h.element()).when({ type: 'intersects', withinMs: 120 }, () => {
      calls++;
    });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();

    const disabled = {
      snapshot: hasta.getDebugSnapshot(),
      overlays: document.querySelectorAll('[data-hasta-debug]').length,
    };

    hasta.setDebug(true);
    h.frame(1030);

    const enabled = {
      calls,
      latched: hasta.getDebugSnapshot().targets[0].rules[0].latched,
      overlays: document.querySelectorAll('[data-hasta-debug]').length,
    };

    hasta.setDebug(false);

    const off = {
      snapshot: hasta.getDebugSnapshot(),
      overlays: document.querySelectorAll('[data-hasta-debug]').length,
    };

    hasta.setDebug(true);
    h.frame(1040);
    const restored = { calls, fireCount: hasta.getDebugSnapshot().targets[0].rules[0].fireCount };
    hasta.destroy();

    return { disabled, enabled, off, restored };
  });

  expect(result).toEqual({
    disabled: { snapshot: null, overlays: 0 },
    enabled: { calls: 1, latched: true, overlays: 1 },
    off: { snapshot: null, overlays: 0 },
    restored: { calls: 1, fireCount: 1 },
  });
});

test('overlay reports measured CSS bounds, margins, samples, prediction and contact state', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta({ debug: { samples: true } });
    const element = h.element();
    element.dataset.hastaLabel = 'Product card';
    hasta.track(element).when({ type: 'intersects', withinMs: 120, marginPx: 4 }, () => {});
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame(1030);
    const snapshot = hasta.getDebugSnapshot();
    const host = document.querySelector('[data-hasta-debug]');
    const shadow = host.shadowRoot;
    const bounds = shadow.querySelector('[data-hasta-bounds]');
    const margin = shadow.querySelector('[data-hasta-margin]');

    const output = {
      status: snapshot.status,
      label: snapshot.targets[0].label,
      bounds: ['x', 'y', 'width', 'height'].map((name) => Number(bounds.getAttribute(name))),
      margin: ['x', 'y', 'width', 'height'].map((name) => Number(margin.getAttribute(name))),
      samples: shadow.querySelector('[data-hasta-samples]').getAttribute('points'),
      trajectory: shadow.querySelector('[data-hasta-trajectory]').getAttribute('points'),
      pointer: Number(shadow.querySelector('[data-hasta-pointer]').getAttribute('cx')),
      endpoint: Number(shadow.querySelector('[data-hasta-endpoint]').getAttribute('cx')),
      contacts: shadow.querySelectorAll('[data-hasta-intersection]').length,
      velocity: snapshot.velocity,
      age: snapshot.sampleAgeMs,
      candidate: snapshot.targets[0].candidate,
      rule: snapshot.targets[0].rules[0],
      panelText: shadow.querySelector('[data-hasta-layer="panel"]').textContent,
    };

    hasta.destroy();

    return output;
  });

  expect(result.status).toBe('tracking');
  expect(result.label).toBe('Product card');
  expect(result.bounds).toEqual([100, 100, 10, 20]);
  expect(result.margin).toEqual([96, 96, 18, 28]);
  expect(result.samples).toBe('0,110 20,110');
  expect(result.trajectory).toBe('30,110 150,110');
  expect(result.pointer).toBe(20);
  expect(result.endpoint).toBe(150);
  expect(result.contacts).toBe(1);
  expect(result.velocity).toEqual({ x: 1, y: 0, speed: 1 });
  expect(result.age).toBe(10);
  expect(result.candidate).toBe(true);
  expect(result.rule).toMatchObject({
    kind: 'intersects',
    withinMs: 120,
    marginPx: 4,
    matches: true,
    eligible: true,
    latched: true,
    running: false,
    fireCount: 1,
    lastFiredAt: 1030,
    intersection: { etaMs: 66, point: { x: 96, y: 110 } },
  });
  expect(result.panelText).toContain('1 target · 120 ms ahead');
});

test('warmup, pause and expiry clear the forecast and idle debug does not create a frame loop', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta({ debug: true });
    const target = hasta.track(h.element());
    target.when({ type: 'intersects', withinMs: 120 }, () => {});
    h.frame();
    const idle = { status: hasta.getDebugSnapshot().status, frames: h.pendingFrames() };
    h.pointer(1000, 0);
    h.frame();
    const warmup = hasta.getDebugSnapshot().status;
    h.pointer(1020, 20);
    h.frame();
    hasta.pause();
    const paused = hasta.getDebugSnapshot();

    const pausedTrajectory =
      document
        .querySelector('[data-hasta-debug]')
        .shadowRoot.querySelector('[data-hasta-trajectory]') !== null;

    hasta.resume();
    h.pointer(1060, 0);
    h.pointer(1080, 20);
    h.frame();
    h.frame(1180);
    const expired = hasta.getDebugSnapshot();
    const idleFrames = h.pendingFrames();
    target.untrack();
    const untracked = hasta.getDebugSnapshot().targets.length;
    hasta.destroy();

    return {
      idle,
      warmup,
      paused: {
        status: paused.status,
        forecast: paused.forecast,
        rect: paused.targets[0].rect,
        trajectory: pausedTrajectory,
      },
      expired: {
        status: expired.status,
        forecast: expired.forecast,
        candidate: expired.targets[0].candidate,
        matches: expired.targets[0].rules[0].matches,
      },
      idleFrames,
      untracked,
      destroyed: {
        snapshot: hasta.getDebugSnapshot(),
        overlays: document.querySelectorAll('[data-hasta-debug]').length,
      },
    };
  });

  expect(result).toEqual({
    idle: { status: 'idle', frames: 0 },
    warmup: 'warming-up',
    paused: {
      status: 'paused',
      forecast: null,
      rect: { minX: 100, minY: 100, maxX: 110, maxY: 120 },
      trajectory: false,
    },
    expired: { status: 'idle', forecast: null, candidate: false, matches: false },
    idleFrames: 0,
    untracked: 0,
    destroyed: { snapshot: null, overlays: 0 },
  });
});

test('layer options hide their visuals without suppressing telemetry or callbacks', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;

    const hasta = h.createHasta({
      debug: {
        bounds: false,
        trajectory: false,
        samples: false,
        intersections: false,
        labels: false,
        panel: false,
      },
    });

    let calls = 0;
    hasta.track(h.element()).when({ type: 'intersects', withinMs: 120, marginPx: 4 }, () => {
      calls++;
    });
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const host = document.querySelector('[data-hasta-debug]');
    const shadow = host.shadowRoot;

    const hidden = {
      count: shadow.querySelectorAll(
        '[data-hasta-bounds], [data-hasta-margin], [data-hasta-trajectory], [data-hasta-samples], [data-hasta-intersection], [data-hasta-label]',
      ).length,
      panel: shadow.querySelector('[data-hasta-layer="panel"]').hidden,
      snapshot: hasta.getDebugSnapshot() !== null,
    };

    hasta.setDebug(true);

    const shown = {
      bounds: shadow.querySelectorAll('[data-hasta-bounds]').length,
      trajectory: shadow.querySelectorAll('[data-hasta-trajectory]').length,
      panel: shadow.querySelector('[data-hasta-layer="panel"]').hidden,
      sameHost: document.querySelector('[data-hasta-debug]') === host,
    };

    hasta.destroy();

    return { hidden, shown, calls };
  });

  expect(result).toEqual({
    hidden: { count: 0, panel: true, snapshot: true },
    shown: { bounds: 1, trajectory: 1, panel: false, sameHost: true },
    calls: 1,
  });
});

test('multiple debug instances own and remove only their own overlay', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const first = h.createHasta({ debug: true });
    const second = h.createHasta({ debug: true });
    first.track(h.element({ x: 100 }));
    second.track(h.element({ x: 300 }));
    h.frame();
    const hosts = [...document.querySelectorAll('[data-hasta-debug]')];

    const positions = hosts.map((host) =>
      Number(host.shadowRoot.querySelector('[data-hasta-bounds]').getAttribute('x')),
    );

    first.destroy();

    const survived = {
      count: document.querySelectorAll('[data-hasta-debug]').length,
      host: hosts[1].isConnected,
      bounds: second.getDebugSnapshot().targets[0].rect.minX,
    };

    second.setDebug(false);
    const removed = document.querySelectorAll('[data-hasta-debug]').length;
    second.destroy();

    return { positions, survived, removed };
  });

  expect(result).toEqual({
    positions: [100, 300],
    survived: { count: 1, host: true, bounds: 300 },
    removed: 0,
  });
});

test('overlay is click-through, hidden from accessibility and absent from keyboard focus order', async ({
  page,
}) => {
  await page.evaluate(() => {
    const h = window.harness;
    window.clicks = 0;
    const first = document.createElement('button');
    first.id = 'first-action';
    first.tabIndex = 0;
    first.textContent = 'First action';
    Object.assign(first.style, {
      position: 'absolute',
      left: '100px',
      top: '100px',
      width: '120px',
      height: '40px',
    });
    first.addEventListener('click', () => {
      window.clicks++;
    });
    const second = document.createElement('button');
    second.id = 'second-action';
    second.tabIndex = 0;
    second.textContent = 'Second action';
    document.body.append(first, second);
    window.debugHasta = h.createHasta({ debug: true });
    window.debugHasta.track(first);
    h.frame();
  });

  const semantics = await page.evaluate(() => {
    const host = document.querySelector('[data-hasta-debug]');

    return {
      hidden: host.getAttribute('aria-hidden'),
      pointerEvents: getComputedStyle(host).pointerEvents,
      focusableChildren: host.shadowRoot.querySelectorAll('button, input, a[href], [tabindex]')
        .length,
      hitTarget: document.elementFromPoint(130, 120)?.id,
    };
  });

  expect(semantics).toEqual({
    hidden: 'true',
    pointerEvents: 'none',
    focusableChildren: 0,
    hitTarget: 'first-action',
  });
  await page.mouse.click(130, 120);
  expect(await page.evaluate(() => window.clicks)).toBe(1);
  await page.locator('#first-action').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#second-action')).toBeFocused();
  await page.evaluate(() => window.debugHasta.destroy());
});

test('async completion waits for evaluation of newer samples before showing a forecast', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const h = window.harness;
    const hasta = h.createHasta({ debug: true });
    let settle;
    hasta.track(h.element()).when(
      { type: 'intersects', withinMs: 120 },
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    h.pointer(1000, 0);
    h.pointer(1020, 20);
    h.frame();
    const started = hasta.getDebugSnapshot();
    h.pointer(1030, 30);
    settle();
    await Promise.resolve();
    const pending = hasta.getDebugSnapshot();
    h.frame();
    const evaluated = hasta.getDebugSnapshot();
    hasta.destroy();

    return {
      running: started.targets[0].rules[0].running,
      pendingStatus: pending.status,
      pendingForecast: pending.forecast,
      settled: pending.targets[0].rules[0].running,
      evaluatedStatus: evaluated.status,
      generatedAt: evaluated.forecast.generatedAt,
      pointerTime: evaluated.pointer.timeStamp,
    };
  });

  expect(result).toEqual({
    running: true,
    pendingStatus: 'pending',
    pendingForecast: null,
    settled: false,
    evaluatedStatus: 'tracking',
    generatedAt: 1030,
    pointerTime: 1030,
  });
});

for (const scenario of [
  { name: 'delayed coalesced sample', timeStamp: 1025, sampleCount: 3 },
  { name: 'same-timestamp sample replacement', timeStamp: 1020, sampleCount: 2 },
]) {
  test(`async completion hides the old forecast for a ${scenario.name}`, async ({ page }) => {
    const result = await page.evaluate(
      async ({ timeStamp }) => {
        const { KalmanPredictor } = await import('/dist/core/index.js');
        const h = window.harness;
        const hasta = h.createHasta({ debug: true });
        let settle;
        let calls = 0;
        hasta.track(h.element()).when({ type: 'intersects', withinMs: 120 }, () => {
          calls++;

          return new Promise((resolve) => {
            settle = resolve;
          });
        });
        h.pointer(1000, 0);
        h.pointer(1020, 20);
        h.frame(1030);
        const started = hasta.getDebugSnapshot();
        // A captured sample can arrive after a frame whose clock is already newer
        h.pointer(1035, 400, 110, { coalesced: [{ timeStamp, x: 400 }] });
        settle();
        await Promise.resolve();
        const pending = hasta.getDebugSnapshot();
        const shadow = document.querySelector('[data-hasta-debug]').shadowRoot;

        const pendingVisuals = shadow.querySelectorAll(
          '[data-hasta-trajectory], [data-hasta-intersection]',
        ).length;

        h.frame(1035);
        const evaluated = hasta.getDebugSnapshot();
        hasta.destroy();
        const predictor = new KalmanPredictor();
        predictor.update({ x: 0, y: 110, timeStamp: 1000 });
        predictor.update({ x: 20, y: 110, timeStamp: 1020 });
        predictor.update({ x: 400, y: 110, timeStamp });

        const hit = predictor.intersectRect(1035, 120, {
          minX: 100,
          minY: 100,
          maxX: 110,
          maxY: 120,
        });

        return {
          expectedStart: predictor.predict(1035, 120).points[0].x,
          expectedIntersection: hit === null ? null : { etaMs: hit.offsetMs, point: hit.point },
          previousStart: started.forecast.points[0].x,
          previousGeneratedAt: started.forecast.generatedAt,
          pendingStatus: pending.status,
          pendingForecast: pending.forecast,
          pendingVelocity: pending.velocity,
          pendingIntersection: pending.targets[0].rules[0].intersection,
          pendingCandidate: pending.targets[0].candidate,
          pendingMatches: pending.targets[0].rules[0].matches,
          pendingRunning: pending.targets[0].rules[0].running,
          pendingPointer: pending.pointer,
          pendingSampleCount: pending.samples.length,
          pendingVisuals,
          evaluatedStatus: evaluated.status,
          evaluatedStart: evaluated.forecast.points[0].x,
          evaluatedGeneratedAt: evaluated.forecast.generatedAt,
          evaluatedIntersection: evaluated.targets[0].rules[0].intersection,
          calls,
        };
      },
      { timeStamp: scenario.timeStamp },
    );

    const { expectedStart, expectedIntersection, ...observed } = result;
    expect(observed).toEqual({
      previousStart: 30,
      previousGeneratedAt: 1030,
      pendingStatus: 'pending',
      pendingForecast: null,
      pendingVelocity: null,
      pendingIntersection: null,
      pendingCandidate: false,
      pendingMatches: false,
      pendingRunning: false,
      pendingPointer: { x: 400, y: 110, timeStamp: scenario.timeStamp },
      pendingSampleCount: scenario.sampleCount,
      pendingVisuals: 0,
      evaluatedStatus: 'tracking',
      evaluatedStart: expectedStart,
      evaluatedGeneratedAt: 1035,
      evaluatedIntersection: expectedIntersection,
      calls: 1,
    });
  });
}

test('debug history is bounded and snapshots stay deeply immutable across new frames', async ({
  page,
}) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta({ debug: true });
    hasta.track(h.element()).when({ type: 'intersects', withinMs: 120 }, () => {});

    for (let i = 0; i < 50; i++) {
      h.pointer(1000 + i, i);
    }

    h.frame();
    const previous = hasta.getDebugSnapshot();
    const rule = previous.targets[0].rules[0];

    const frozen = [
      previous,
      previous.targets,
      previous.targets[0],
      previous.targets[0].rect,
      previous.targets[0].rules,
      rule,
      rule.intersection,
      rule.intersection.point,
      previous.samples,
      previous.samples[0],
      previous.pointer,
      previous.velocity,
      previous.forecast,
      previous.forecast.points,
      previous.forecast.points[0],
    ].every((value) => Object.isFrozen(value));

    h.pointer(1050, 50);
    h.frame();
    const current = hasta.getDebugSnapshot();
    hasta.destroy();

    return {
      frozen,
      before: {
        length: previous.samples.length,
        start: previous.samples[0].timeStamp,
        end: previous.samples.at(-1).timeStamp,
        pointer: previous.pointer.x,
      },
      after: {
        length: current.samples.length,
        start: current.samples[0].timeStamp,
        end: current.samples.at(-1).timeStamp,
        pointer: current.pointer.x,
      },
      different: previous !== current,
    };
  });

  expect(result).toEqual({
    frozen: true,
    before: { length: 32, start: 1018, end: 1049, pointer: 49 },
    after: { length: 32, start: 1019, end: 1050, pointer: 50 },
    different: true,
  });
});

test('labels render as text and invalid debug options are rejected', async ({ page }) => {
  const result = await page.evaluate(() => {
    const h = window.harness;
    const hasta = h.createHasta({ debug: true });
    const element = h.element();
    element.dataset.hastaLabel = '<img src=x onerror="window.injected=true">';
    hasta.track(element);
    h.frame();
    const shadow = document.querySelector('[data-hasta-debug]').shadowRoot;

    const rendered = {
      includesLiteral: shadow.textContent.includes('<img src=x'),
      imageNodes: shadow.querySelectorAll('img').length,
      injected: window.injected === true,
    };

    let errors = 0;

    for (const value of [null, [], 'on', { bounds: 'yes' }]) {
      try {
        hasta.setDebug(value);
      } catch (error) {
        if (error instanceof TypeError) {
          errors++;
        }
      }
    }

    const hosts = document.querySelectorAll('[data-hasta-debug]').length;
    hasta.destroy();

    return { rendered, errors, hosts };
  });

  expect(result).toEqual({
    rendered: { includesLiteral: true, imageNodes: 0, injected: false },
    errors: 4,
    hosts: 1,
  });
});
