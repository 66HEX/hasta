import { expect, test } from '@playwright/test';

async function approachBrand(page, distance = 80, below = 0) {
  await page.evaluate(
    ([distance, below]) => {
      const box = document.querySelector('[aria-label="Hasta home"]').getBoundingClientRect();
      const now = performance.now();

      for (const [offset, age] of [
        [20, 20],
        [0, 0],
      ]) {
        const event = new PointerEvent('pointermove', {
          bubbles: true,
          pointerType: 'mouse',
          clientX: box.right + distance + offset,
          clientY: below === 0 ? box.y + box.height / 2 : box.bottom + below,
        });

        Object.defineProperty(event, 'timeStamp', { value: now - age });
        document.dispatchEvent(event);
      }
    },
    [distance, below],
  );
}

test('a predicted approach plays the whole unmuted clip without hover or controls', async ({
  page,
}) => {
  await page.goto('/');
  const brand = page.getByRole('link', { name: 'Hasta home' });
  await expect(brand).toBeVisible();
  await page.mouse.click(10, 10);
  await approachBrand(page);
  const card = page.getByRole('dialog', { name: 'Surprise from Doakes' });
  await expect(card).toBeVisible();
  expect(await brand.evaluate((element) => element.matches(':hover'))).toBe(false);
  await expect(card.locator('button')).toHaveCount(0);
  const video = card.locator('video');

  const playback = await video.evaluate((element) => {
    element.addEventListener(
      'ended',
      () => {
        window.clipEndedAt = element.currentTime;
      },
      { once: true },
    );

    return {
      muted: element.muted,
      controls: element.controls,
      loop: element.loop,
      paused: element.paused,
    };
  });

  expect(playback).toEqual({ muted: false, controls: false, loop: false, paused: false });
  await page.mouse.click(1200, 800);
  await expect(card).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.clipEndedAt ?? 0)).toBeGreaterThan(3.9);
  await expect(card).toBeHidden();
  await approachBrand(page);
  await page.waitForTimeout(150);
  await expect(card).toBeHidden();
});

test('header prediction follows both demo sliders', async ({ page }) => {
  await page.goto('/');
  const horizon = page.getByRole('slider', { name: 'Look ahead' });
  const margin = page.getByRole('slider', { name: 'Target margin' });
  await horizon.press('Home');
  await margin.press('Home');
  const card = page.getByRole('dialog', { name: 'Surprise from Doakes' });
  await approachBrand(page, 200);
  await page.waitForTimeout(150);
  await expect(card).toBeHidden();
  await horizon.press('End');
  await approachBrand(page, 200);
  await expect(card).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();

  await page.reload();
  await horizon.press('End');
  await margin.press('Home');
  await approachBrand(page, 80, 20);
  await page.waitForTimeout(150);
  await expect(card).toBeHidden();
  await margin.press('End');
  await approachBrand(page, 80, 20);
  await expect(card).toBeVisible();
});

test('blocked sound never exposes a silent or waiting card and only a new approach retries', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    window.clipPlayAttempts = 0;
    HTMLMediaElement.prototype.play = function () {
      window.clipPlayAttempts++;

      if (window.clipPlayAttempts === 1) {
        return Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'));
      }

      return play.call(this);
    };
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Hasta home' })).toBeVisible();
  const card = page.getByRole('dialog', { name: 'Surprise from Doakes' });
  await approachBrand(page);
  await expect.poll(() => page.evaluate(() => window.clipPlayAttempts)).toBe(1);
  await expect(card).toBeHidden();
  await expect(page.locator('video')).toHaveCount(0);
  await page.mouse.click(10, 10);
  await page.waitForTimeout(150);
  await expect(card).toBeHidden();
  expect(await page.evaluate(() => window.clipPlayAttempts)).toBe(1);
  await approachBrand(page);
  await expect(card).toBeVisible();
  expect(await page.locator('video').evaluate((video) => video.muted)).toBe(false);
});

test('reduced motion waits for keyboard activation and Escape restores focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const brand = page.getByRole('link', { name: 'Hasta home' });
  await expect(brand).toBeVisible();
  await approachBrand(page);
  await page.waitForTimeout(150);
  const card = page.getByRole('dialog', { name: 'Surprise from Doakes' });
  await expect(card).toBeHidden();
  await brand.press('ArrowDown');
  await expect(card).toBeVisible();
  await expect(card).toBeFocused();
  await expect(card).toHaveCSS('rotate', '0deg');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(brand).toBeFocused();
  await brand.press('Enter');
  await expect(page.locator('main')).toBeFocused();
});

for (const width of [320, 390]) {
  test(`the tilted card stays inside the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    await page.getByRole('link', { name: 'Hasta home' }).press('ArrowDown');
    const card = page.getByRole('dialog', { name: 'Surprise from Doakes' });
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(800);
  });
}
