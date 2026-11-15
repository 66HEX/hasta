import { expect, test } from '@playwright/test';

for (const name of ['Profile', 'Settings']) {
  test(`a real forecast activates ${name} before hover and cancels when the approach expires`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.goto('/');
    await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
    const demo = page.locator('[data-demo="prediction"]');
    const target = demo.locator(`[data-demo-target="${name}"]`);
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    const x = box.x + box.width / 2;
    await page.mouse.move(x, box.y - 140);

    for (let index = 0; index < 21; index++) {
      await page.mouse.move(x, box.y - 135 + index * 6);
      await page.clock.runFor(16);
    }

    const deck = page.locator('[data-preview-active]');
    await expect(deck).toHaveAttribute('data-preview-active', name);
    await expect(target).toHaveAttribute('data-predicted', 'true');
    expect(await target.evaluate((element) => element.matches(':hover'))).toBe(false);
    await expect(page.locator('[data-demo="prediction"] figcaption')).toContainText(
      new RegExp(`${name} predicted [1-9]\\d* ms before entry`, 'u'),
    );
    await page.clock.runFor(200);
    await expect(deck).toHaveAttribute('data-preview-active', 'none');

    await page.mouse.move(x, box.y + box.height / 2);
    await page.clock.runFor(16);
    await expect(deck).toHaveAttribute('data-preview-active', name);
    await page.clock.runFor(120);
    await expect(target).toHaveAttribute('data-predicted', 'false');
    await expect(deck).toHaveAttribute('data-preview-active', name);
    await page.mouse.move(0, 0);
    await expect(deck).toHaveAttribute('data-preview-active', 'none');
  });
}

test('keyboard and direct activation select previews without manufacturing predictions', async ({
  page,
  browserName,
}) => {
  await page.goto('/');
  const deck = page.locator('[data-preview-active]');
  const profile = page.getByRole('button', { name: 'Preview Profile' });
  await profile.focus();
  await expect(deck).toHaveAttribute('data-preview-active', 'Profile');
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  const settings = page.getByRole('button', { name: 'Preview Settings' });
  await expect(settings).toBeFocused();
  await expect(deck).toHaveAttribute('data-preview-active', 'Settings');
  await settings.press('Space');
  await expect(settings).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('slider', { name: 'Look ahead' }).focus();
  await expect(deck).toHaveAttribute('data-preview-active', 'Settings');
  await expect(page.locator('[data-prediction-count="0"]')).toHaveCount(2);

  await profile.dispatchEvent('click', { pointerType: 'touch' });
  await expect(profile).toHaveAttribute('aria-pressed', 'true');
  await expect(settings).toHaveAttribute('aria-pressed', 'false');
  await expect(deck).toHaveAttribute('data-preview-active', 'Profile');
  await profile.dispatchEvent('click', { pointerType: 'touch' });
  await expect(deck).toHaveAttribute('data-preview-active', 'none');
  await expect(page.locator('[data-prediction-count="0"]')).toHaveCount(2);
});

test('stability waits for a continuous match and zero restores immediate callbacks', async ({
  page,
}) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
  const stability = page.getByRole('slider', { name: 'Stability' });
  await expect(stability).toHaveAttribute('aria-valuenow', '0');
  await stability.press('End');
  await expect(stability).toHaveAttribute('aria-valuenow', '200');
  await stability.press('Home');

  for (let step = 0; step < 3; step++) {
    await stability.press('ArrowRight');
  }

  await expect(stability).toHaveAttribute('aria-valuenow', '30');
  const target = page.locator('[data-demo-target="Settings"]');
  const box = await target.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.clock.runFor(16);
  await page.mouse.move(x + 1, y);
  await page.clock.runFor(16);
  await expect(target).toHaveAttribute('data-prediction-count', '0');
  await page.clock.runFor(32);
  await expect(target).toHaveAttribute('data-prediction-count', '1');
  await page.clock.runFor(120);

  await page.mouse.move(x + 2, y);
  await page.clock.runFor(16);
  await page.mouse.move(x + 3, y);
  await page.clock.runFor(16);
  await page.mouse.move(0, 0);
  await page.clock.runFor(160);
  await expect(target).toHaveAttribute('data-prediction-count', '1');

  await stability.press('Home');
  await page.mouse.move(x, y);
  await page.clock.runFor(16);
  await page.mouse.move(x + 1, y);
  await page.clock.runFor(16);
  await expect(target).toHaveAttribute('data-prediction-count', '2');
});
