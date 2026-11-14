import { expect, test } from '@playwright/test';

async function configure(demo, horizon, margin) {
  const lookAhead = demo.getByRole('slider', { name: 'Look ahead' });
  const targetMargin = demo.getByRole('slider', { name: 'Target margin' });
  await lookAhead.focus();
  await lookAhead.press('Home');

  for (let value = 60; value < horizon; value += 10) {
    await lookAhead.press('ArrowRight');
  }

  await targetMargin.focus();
  await targetMargin.press('Home');

  for (let value = 0; value < margin; value += 2) {
    await targetMargin.press('ArrowRight');
  }
}

test('moving inside the target reactivates it after each idle expiry', async ({ page }) => {
  await page.goto('/');
  const demo = page.locator('[data-demo="prediction"]');
  const target = demo.locator('[data-demo-target="Settings"]');
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);

  for (let cycle = 0; cycle < 5; cycle++) {
    await expect(target).toHaveAttribute('data-predicted', 'false');

    for (let step = 0; step < 4; step++) {
      await page.mouse.move(x - 3 + step * 2, y);
      await page.waitForTimeout(16);
    }

    await expect(target).toHaveAttribute('data-predicted', 'true');
    await expect(target).toHaveAttribute('data-predicted', 'false');
  }

  await expect(demo.locator('figcaption')).toContainText('5 callbacks');
});

for (const width of [390, 1440]) {
  test(`fast live sweeps light both targets at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/');
    const demo = page.locator('[data-demo="prediction"]');
    await configure(demo, 60, 0);
    const targets = demo.locator('[data-demo-target]');
    await targets.first().scrollIntoViewIfNeeded();
    const first = await targets.first().boundingBox();
    const last = await targets.last().boundingBox();
    const left = first.x - 12;
    const right = last.x + last.width + 12;
    const y = first.y + first.height / 2;
    await page.mouse.move(left, y);

    for (let run = 0; run < 10; run++) {
      const start = run % 2 === 0 ? left : right;
      const end = run % 2 === 0 ? right : left;
      await page.mouse.move(start, y);
      await page.waitForTimeout(20);
      await page.mouse.move(start + (run % 2 === 0 ? -1 : 1), y);
      await page.waitForTimeout(20);
      await page.mouse.move(end, y);
      await expect
        .poll(() =>
          targets.evaluateAll((elements) =>
            elements.map((element) => Number(element.dataset.predictionCount)),
          ),
        )
        .toEqual([run + 1, run + 1]);
      await expect
        .poll(() =>
          targets.evaluateAll((elements) =>
            elements.every((element) => element.dataset.highlighted === 'true'),
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          targets.evaluateAll((elements) =>
            elements.every((element) => element.dataset.highlighted === 'false'),
          ),
        )
        .toBe(true);
    }
  });
}

test('the demo stays idle without real mouse input and exposes only the library overlay', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.syntheticMoves = 0;
    document.addEventListener('pointermove', (event) => {
      if (!event.isTrusted) {
        window.syntheticMoves++;
      }
    });
  });
  await page.goto('/');
  const demo = page.locator('[data-demo="prediction"]');
  await expect(demo.getByRole('button', { name: /play|stop/iu })).toHaveCount(0);
  await expect(demo.getByRole('switch', { name: 'Inspect', exact: true })).toHaveCount(0);
  const debug = demo.getByRole('switch', { name: 'Show the library debug overlay' });
  await debug.focus();
  await page.keyboard.press('Space');
  await expect(page.locator('[data-hasta-bounds]')).toHaveCount(3);
  await expect(demo.locator('[data-demo-bounds]')).toHaveCount(0);
  await page.waitForTimeout(1100);
  await expect(demo.locator('[data-prediction-count="0"]')).toHaveCount(2);
  expect(await page.evaluate(() => window.syntheticMoves)).toBe(0);
  await page.keyboard.press('Space');
  await expect(page.locator('[data-hasta-debug]')).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`the library summary follows the page's ${theme} Zinc surface`, async ({ page }) => {
    await page.addInitScript((theme) => localStorage.setItem('hasta.theme', theme), theme);
    await page.goto('/');
    const demo = page.locator('[data-demo="prediction"]');
    await demo.getByRole('switch', { name: 'Show the library debug overlay' }).check();
    const panel = page.locator('[data-hasta-layer="panel"]');
    const card = demo.locator('[data-slot="card"]');
    expect(await panel.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe(
      await card.evaluate((element) => getComputedStyle(element).backgroundColor),
    );
    await expect(panel).toHaveText('hastaIdle3 targets · 160 ms ahead');
    expect((await panel.boundingBox()).height).toBeLessThanOrEqual(70);
    await expect(panel.locator('.legend, .row, .note')).toHaveCount(0);
  });
}

test('pointer status cross-fades on movement without changing width and settles after stopping', async ({
  page,
}) => {
  await page.goto('/');
  const demo = page.locator('[data-demo="prediction"]');
  await demo.scrollIntoViewIfNeeded();
  const status = demo.locator('[data-demo-pointer-status]');
  const idle = status.locator('[data-pointer-idle]');
  const live = status.locator('[data-pointer-live]');
  const before = await status.boundingBox();
  const stage = await demo.locator('[data-demo-stage]').boundingBox();
  await page.mouse.move(stage.x + 30, stage.y + 45);

  const transition = await status.evaluate((element) => {
    const animations = element.getAnimations({ subtree: true });

    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 75;
    }

    const idleOpacity = Number(
      getComputedStyle(element.querySelector('[data-pointer-idle]')).opacity,
    );

    const liveOpacity = Number(
      getComputedStyle(element.querySelector('[data-pointer-live]')).opacity,
    );

    for (const animation of animations) {
      animation.play();
    }

    return { count: animations.length, idleOpacity, liveOpacity };
  });

  expect(transition.count).toBeGreaterThan(0);
  expect(transition.idleOpacity).toBeGreaterThan(0);
  expect(transition.idleOpacity).toBeLessThan(1);
  expect(transition.liveOpacity).toBeGreaterThan(0);
  expect(transition.liveOpacity).toBeLessThan(1);
  expect((await status.boundingBox()).width).toBe(before.width);
  await expect(live).toHaveAttribute('aria-hidden', 'false');
  await expect(idle).toHaveAttribute('aria-hidden', 'true');

  for (let index = 0; index < 4; index++) {
    await page.mouse.move(stage.x + 30, stage.y + 45);
    await page.mouse.move(0, 0);
  }

  await expect(status).toHaveAttribute('data-live', 'false');
  await expect(idle).toHaveCSS('opacity', '1');
  await expect(live).toHaveCSS('opacity', '0');
  expect((await status.boundingBox()).width).toBe(before.width);
});

for (const overlay of [false, true]) {
  test(`pointer status follows page-wide movement with debug ${overlay ? 'on' : 'off'}`, async ({
    page,
  }) => {
    await page.goto('/');
    const demo = page.locator('[data-demo="prediction"]');

    if (overlay) {
      await demo.getByRole('switch', { name: 'Show the library debug overlay' }).check();
    }

    const stage = demo.locator('[data-demo-stage]');
    const status = demo.locator('[data-demo-pointer-status]');
    const debug = page.locator('[data-hasta-debug]');
    await stage.scrollIntoViewIfNeeded();
    const box = await stage.boundingBox();

    // Entering under a stationary cursor must not count as movement
    await stage.dispatchEvent('pointerover', { pointerType: 'mouse' });
    await expect(status).toHaveAttribute('data-live', 'false');

    for (let cycle = 0; cycle < 3; cycle++) {
      const inside = cycle === 1;
      const startX = box.x + (inside ? 30 : -60);

      for (let step = 0; step < 4; step++) {
        await page.mouse.move(startX + step * 2, box.y + 45);
        await page.waitForTimeout(16);
      }

      await expect(status).toHaveAttribute('data-live', 'true');

      if (overlay) {
        await expect(debug).toHaveAttribute('data-hasta-status', 'tracking');
      }

      await expect(status).toHaveAttribute('data-live', 'false');

      if (overlay) {
        await expect(debug).toHaveAttribute('data-hasta-status', 'idle');
      }

      await expect(status.locator('[data-pointer-idle]')).toHaveAttribute('aria-hidden', 'false');
      await expect(status.locator('[data-pointer-live]')).toHaveAttribute('aria-hidden', 'true');
      expect(await stage.evaluate((element) => element.matches(':hover'))).toBe(inside);
    }

    await page.mouse.move(box.x - 70, box.y + 45);
    await expect(status).toHaveAttribute('data-live', 'true');
    await page.mouse.down();
    await page.mouse.move(box.x - 80, box.y + 45);
    await expect(status).toHaveAttribute('data-live', 'false');
    await page.mouse.up();
    await page.mouse.move(box.x - 90, box.y + 45);
    await expect(status).toHaveAttribute('data-live', 'true');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect(status).toHaveAttribute('data-live', 'false');
    await stage.dispatchEvent('pointermove', { pointerType: 'touch', clientX: box.x + 100 });
    await stage.dispatchEvent('pointermove', { pointerType: 'pen', clientX: box.x + 110 });
    await expect(status).toHaveAttribute('data-live', 'false');
  });
}

test('pointer status stays live through brief stops without delaying debug expiry', async ({
  page,
}) => {
  await page.goto('/');
  const demo = page.locator('[data-demo="prediction"]');
  await demo.getByRole('switch', { name: 'Show the library debug overlay' }).check();
  const status = demo.locator('[data-demo-pointer-status]');
  const debug = page.locator('[data-hasta-debug]');
  await demo.scrollIntoViewIfNeeded();
  const box = await demo.locator('[data-demo-stage]').boundingBox();
  await expect(status).toHaveAttribute('data-live', 'false');
  await status.evaluate((element) => {
    window.pointerStatusChanges = [];

    const observer = new MutationObserver(() => {
      window.pointerStatusChanges.push(element.dataset.live);
    });

    observer.observe(element, { attributes: true, attributeFilter: ['data-live'] });
  });

  for (let cycle = 0; cycle < 4; cycle++) {
    await page.mouse.move(box.x - 60 + cycle * 4, box.y + 45);
    await page.waitForTimeout(16);
    await page.mouse.move(box.x - 58 + cycle * 4, box.y + 45);
    await expect(status).toHaveAttribute('data-live', 'true');
    await expect(debug).toHaveAttribute('data-hasta-status', 'tracking');
    await page.waitForTimeout(150);
    await expect(debug).toHaveAttribute('data-hasta-status', 'idle');
    await expect(status).toHaveAttribute('data-live', 'true');
  }

  await expect(status).toHaveAttribute('data-live', 'false');
  expect(await page.evaluate(() => window.pointerStatusChanges)).toEqual(['true', 'false']);
});

test('reduced motion switches pointer status without animated transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const demo = page.locator('[data-demo="prediction"]');
  await demo.scrollIntoViewIfNeeded();
  const stage = await demo.locator('[data-demo-stage]').boundingBox();
  await page.mouse.move(stage.x + 30, stage.y + 45);
  const status = demo.locator('[data-demo-pointer-status]');
  await expect(status).toHaveAttribute('data-live', 'true');
  await expect(status.locator('[data-pointer-live]')).toHaveCSS('opacity', '1');
  await expect(status.locator('[data-pointer-live]')).toHaveCSS('transition-property', 'none');
  await expect(status.locator('[data-pointer-dot]')).toHaveCSS('transition-property', 'none');
  expect(await status.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(
    0,
  );
});
