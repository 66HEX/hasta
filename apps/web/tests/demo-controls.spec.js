import { AxeBuilder } from '@axe-core/playwright';
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

for (const width of [320, 390, 1280]) {
  test.describe(`demo settings at ${width}px`, () => {
    test.use({ viewport: { width, height: 1000 } });

    test('pass accessibility checks', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('hasta');

      const accessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();

      expect(accessibility.violations).toEqual([]);
    });

    test('retain two columns and keyboard controls', async ({ page }) => {
      await page.goto('/');
      const demo = page.locator('[data-demo="prediction"]');

      for (const [name, value] of [
        ['Look ahead', '160'],
        ['Target margin', '4'],
        ['Stability', '0'],
        ['Cooldown', '0'],
      ]) {
        await expect(demo.getByRole('slider', { name, exact: true })).toHaveAttribute(
          'aria-valuenow',
          value,
        );
        await expect(demo.getByRole('slider', { name, exact: true })).toHaveAttribute(
          'aria-valuetext',
          `${value} ${name === 'Target margin' ? 'pixels' : 'milliseconds'}`,
        );
        await expect(demo.getByRole('slider', { name, exact: true })).toHaveAccessibleDescription(
          /.+/u,
        );
      }

      const cooldown = demo.getByRole('slider', { name: 'Cooldown' });
      await cooldown.press('End');
      await expect(cooldown).toHaveAttribute('aria-valuenow', '1000');
      await cooldown.press('Home');
      await cooldown.press('ArrowRight');
      await expect(cooldown).toHaveAttribute('aria-valuenow', '50');
      const contact = demo.getByRole('switch', { name: 'Include current contact' });
      const once = demo.getByRole('switch', { name: 'Once per target' });
      await expect(contact).toBeChecked();
      await expect(once).not.toBeChecked();
      await once.press('Space');
      await expect(once).toBeChecked();

      for (const slider of await demo.getByRole('slider').all()) {
        await slider.press('End');
      }

      const cells = await demo.locator('[data-demo-controls] > div').evaluateAll((elements) =>
        elements.map((element) => {
          const rect = element.getBoundingClientRect();

          return { left: rect.left, right: rect.right, top: rect.top, width: rect.width };
        }),
      );

      expect(cells).toHaveLength(8);

      for (let index = 0; index < cells.length; index++) {
        expect(cells[index].left).toBe(cells[index % 2].left);
        expect(cells[index].width).toBe(cells[index % 2].width);
        expect(cells[index].left).toBeGreaterThanOrEqual(0);
        expect(cells[index].right).toBeLessThanOrEqual(width);
        expect(cells[index].top).toBe(cells[index - (index % 2)].top);
      }

      const reset = demo.getByRole('button', { name: 'Reset activity' });
      const resetBox = await reset.boundingBox();
      const resetLabel = await demo.locator('[id$="-reset-label"]').boundingBox();
      expect(resetLabel.x + resetLabel.width).toBeLessThan(resetBox.x);
      expect(resetBox.x + resetBox.width).toBeCloseTo(cells[6].right, 0);
      await expect(reset).toHaveText('Reset');
      await expect(reset).toHaveCSS('height', '28px');
      await expect(
        demo.getByRole('switch', { name: 'Show the library debug overlay' }),
      ).toBeVisible();

      const tracks = await demo
        .locator('[data-slot="slider-track"]')
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().top));

      expect(Math.abs(tracks[0] - tracks[1])).toBeLessThan(1);
      expect(Math.abs(tracks[2] - tracks[3])).toBeLessThan(1);
      await demo.screenshot({ path: `/tmp/hasta-demo-controls-${width}.png` });
    });
  });
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
