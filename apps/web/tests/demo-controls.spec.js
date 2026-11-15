import { expect, test } from '@playwright/test';

async function openDemo(page) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') });
  await page.goto('/');
  await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));

  return page.locator('[data-demo="prediction"]');
}

async function moveInside(page, target, offset = 0) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  const x = box.x + box.width / 2 + offset;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.clock.runFor(16);
  await page.mouse.move(x + 1, y);
  await page.clock.runFor(16);
}

test('current contact control changes callbacks while direct previews remain usable', async ({
  page,
}) => {
  const demo = await openDemo(page);
  const contact = demo.getByRole('switch', { name: 'Include current contact' });
  const target = demo.locator('[data-demo-target="Settings"]');
  await contact.uncheck();
  await moveInside(page, target);
  await expect(target).toHaveAttribute('data-prediction-count', '0');
  await expect(demo.locator('[data-preview-active]')).toHaveAttribute(
    'data-preview-active',
    'Settings',
  );
  await contact.check();
  await moveInside(page, target);
  await expect(target).toHaveAttribute('data-prediction-count', '1');
});

test('once per target remains spent until reset activity and keeps its settings', async ({
  page,
}) => {
  const demo = await openDemo(page);
  const once = demo.getByRole('switch', { name: 'Once per target' });
  const target = demo.locator('[data-demo-target="Settings"]');
  await once.check();
  await moveInside(page, target);
  await expect(target).toHaveAttribute('data-prediction-count', '1');
  await page.clock.runFor(160);
  await moveInside(page, target, 2);
  await expect(target).toHaveAttribute('data-prediction-count', '1');
  const reset = demo.getByRole('button', { name: 'Reset activity' });
  await reset.focus();
  await reset.press('Enter');
  await expect(reset).toBeFocused();
  await expect(demo.locator('[data-prediction-count="0"]')).toHaveCount(2);
  await expect(demo.locator('figcaption')).toContainText('Move toward a view');
  await expect(once).toBeChecked();
  await moveInside(page, target);
  await expect(target).toHaveAttribute('data-prediction-count', '1');
});

test('cooldown suppresses repeated callbacks and elapsed time still needs fresh movement', async ({
  page,
}) => {
  const demo = await openDemo(page);
  const cooldown = demo.getByRole('slider', { name: 'Cooldown' });
  const target = demo.locator('[data-demo-target="Settings"]');
  await cooldown.press('End');
  await moveInside(page, target);
  await expect(target).toHaveAttribute('data-prediction-count', '1');
  await page.clock.runFor(160);
  await moveInside(page, target, 2);
  await expect(target).toHaveAttribute('data-prediction-count', '1');
  await page.clock.runFor(1000);
  await expect(target).toHaveAttribute('data-prediction-count', '1');
  await moveInside(page, target, 4);
  await expect(target).toHaveAttribute('data-prediction-count', '2');
});
