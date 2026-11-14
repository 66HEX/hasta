import { expect, test } from '@playwright/test';

async function previewColors(demo, name) {
  return demo.evaluate(
    (element, token) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--accent-foreground)';
      probe.style.backgroundColor = `color-mix(in oklab, var(${token}) 10%, transparent)`;
      probe.style.borderColor = `var(${token})`;
      probe.style.outlineColor = 'var(--accent)';
      element.append(probe);
      const style = getComputedStyle(probe);

      const values = {
        foreground: style.color,
        background: style.backgroundColor,
        border: style.borderColor,
        heading: style.outlineColor,
      };

      probe.remove();

      return values;
    },
    name === 'Profile' ? '--color-emerald-500' : '--color-blue-500',
  );
}

async function expectPreviewColors(demo, name, colors) {
  const target = demo.getByRole('button', { name: `Preview ${name}` });
  const card = demo.locator(`[data-view="${name}"]`);
  await expect(card).toHaveAttribute('data-active', 'true');
  await expect(card).toHaveCSS('border-color', colors.border);
  await expect(target).toHaveCSS('border-color', colors.border);
  await expect(target).toHaveCSS('background-color', colors.background);

  const corners = demo.locator('[data-preview-corner]');
  await expect(corners).toHaveCount(4);

  for (const corner of await corners.all()) {
    await expect(corner).toHaveCSS('border-color', colors.border);
    await expect(corner).toHaveCSS('opacity', '1');
  }
}

for (const theme of ['light', 'dark']) {
  test(`hover and focus share the card colors in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((theme) => localStorage.setItem('hasta.theme', theme), theme);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const demo = page.locator('[data-demo="prediction"]');

    for (const name of ['Profile', 'Settings']) {
      const colors = await previewColors(demo, name);
      const target = demo.getByRole('button', { name: `Preview ${name}` });
      await target.focus();
      await expectPreviewColors(demo, name, colors);
      const card = demo.locator(`[data-view="${name}"]`);
      await expect(card.locator(':scope > div').first()).toHaveCSS(
        'background-color',
        colors.heading,
      );
      await expect(target).toHaveCSS('color', colors.foreground);

      const deckBox = await demo.locator('[data-preview-active]').boundingBox();
      const cardBox = await card.boundingBox();
      expect(cardBox.x + cardBox.width / 2).toBeCloseTo(deckBox.x + deckBox.width / 2, 0);

      await demo.getByRole('slider', { name: 'Look ahead' }).focus();
      await target.hover();
      await expectPreviewColors(demo, name, colors);
      await page.mouse.move(0, 0);
    }
  });
}

for (const name of ['Profile', 'Settings']) {
  test(`a real forecast colors ${name} before hover and cancels when the approach expires`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
    await page.goto('/');
    await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
    const demo = page.locator('[data-demo="prediction"]');
    const colors = await previewColors(demo, name);
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
    await expectPreviewColors(demo, name, colors);
    expect(await target.evaluate((element) => element.matches(':hover'))).toBe(false);
    await expect(page.locator('[data-demo="prediction"] figcaption')).toContainText(
      new RegExp(`${name} predicted [1-9]\\d* ms before entry`, 'u'),
    );
    await page.clock.runFor(200);
    await expect(deck).toHaveAttribute('data-preview-active', 'none');
    await expect(demo.locator('[data-preview-corner]').first()).toHaveCSS('opacity', '0');
    await expect(target).not.toHaveCSS('border-color', colors.border);
    await expect(target).not.toHaveCSS('background-color', colors.background);

    await page.mouse.move(x, box.y + box.height / 2);
    await page.clock.runFor(16);
    await expect(deck).toHaveAttribute('data-preview-active', name);
    await page.clock.runFor(120);
    await expect(target).toHaveAttribute('data-predicted', 'false');
    await expect(deck).toHaveAttribute('data-preview-active', name);
    await expectPreviewColors(demo, name, colors);
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

test('preview transitions reverse in place and reduced motion keeps the controls usable', async ({
  page,
}) => {
  await page.goto('/');
  const profile = page.getByRole('button', { name: 'Preview Profile' });
  const settings = page.getByRole('button', { name: 'Preview Settings' });
  await profile.focus();
  const card = page.locator('[data-view="Profile"]');

  const transition = await card.evaluate((element) => {
    const animation = element
      .getAnimations()
      .find((value) => value.transitionProperty === 'translate');

    const frames = animation?.effect.getKeyframes();

    return { duration: animation?.effect.getTiming().duration, frames: frames?.length };
  });

  expect(transition.duration).toBe(300);
  expect(transition.frames).toBe(2);
  await settings.focus();
  await expect(page.locator('[data-preview-active]')).toHaveAttribute(
    'data-preview-active',
    'Settings',
  );
  await expect(page.locator('[data-view][data-active="true"]')).toHaveCount(1);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await profile.focus();
  await expect(page.locator('[data-preview-active]')).toHaveAttribute(
    'data-preview-active',
    'Profile',
  );

  const durations = await page
    .locator('[data-preview-active], [data-preview-active] *')
    .evaluateAll((elements) =>
      elements.flatMap((element) =>
        getComputedStyle(element)
          .transitionDuration.split(',')
          .map((duration) => Number(duration.trim().slice(0, -1))),
      ),
    );

  expect(Math.max(...durations)).toBeLessThanOrEqual(0.001);
});
