import { expect, test } from '@playwright/test';

test('a real forecast opens a preview before hover and cancels when the approach expires', async ({
  page,
}) => {
  await page.goto('/');
  const target = page.locator('[data-demo-target="Settings"]');
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const x = box.x + box.width / 2;
  await page.mouse.move(x, box.y - 140);

  for (let index = 0; index < 21; index++) {
    await page.mouse.move(x, box.y - 135 + index * 6);
    await page.waitForTimeout(16);
  }

  const deck = page.locator('[data-preview-active]');
  await expect(deck).toHaveAttribute('data-preview-active', 'Settings');
  expect(await target.evaluate((element) => element.matches(':hover'))).toBe(false);
  await expect(page.locator('[data-demo="prediction"] figcaption')).toContainText(
    /Settings predicted [1-9]\d* ms before entry/u,
  );
  await expect(deck.locator('[data-view="Settings"]')).toHaveAttribute('data-active', 'true');
  await expect(deck).toHaveAttribute('data-preview-active', 'none');

  await page.mouse.move(x, box.y + box.height / 2);
  await expect(deck).toHaveAttribute('data-preview-active', 'Settings');
  await expect(target).toHaveAttribute('data-predicted', 'false');
  await expect(deck).toHaveAttribute('data-preview-active', 'Settings');
  await page.mouse.move(0, 0);
  await expect(deck).toHaveAttribute('data-preview-active', 'none');
});

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

test('preview transitions reverse in place and reduced motion keeps the controls usable', async ({
  page,
}) => {
  await page.goto('/');
  const profile = page.getByRole('button', { name: 'Preview Profile' });
  const settings = page.getByRole('button', { name: 'Preview Settings' });
  await profile.focus();
  const card = page.locator('.preview-card[data-view="Profile"]');

  const transition = await card.evaluate((element) => {
    const animation = element
      .getAnimations()
      .find((value) => value.transitionProperty === 'transform');

    const frames = animation?.effect.getKeyframes();

    return { duration: animation?.effect.getTiming().duration, frames: frames?.length };
  });

  expect(transition.duration).toBe(420);
  expect(transition.frames).toBe(2);
  await settings.focus();
  await expect(page.locator('[data-preview-active]')).toHaveAttribute(
    'data-preview-active',
    'Settings',
  );
  await expect(page.locator('.preview-card[data-active="true"]')).toHaveCount(1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await profile.focus();
  await expect(page.locator('[data-preview-active]')).toHaveAttribute(
    'data-preview-active',
    'Profile',
  );

  const durations = await page.locator('.preview-deck, .preview-deck *').evaluateAll((elements) =>
    elements.flatMap((element) =>
      getComputedStyle(element)
        .transitionDuration.split(',')
        .map((duration) => Number(duration.trim().slice(0, -1))),
    ),
  );

  expect(Math.max(...durations)).toBeLessThanOrEqual(0.001);
});
