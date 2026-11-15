import { expect, test } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('hasta');
}

async function selectFramework(page, name) {
  await page.getByRole('combobox', { name: 'Code framework' }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

test('the header framework choice updates all examples and persists on reload', async ({
  page,
}) => {
  await ready(page);
  await selectFramework(page, 'Vue');
  await expect(page.locator('[data-framework-panel]')).toHaveCount(2);

  for (const panel of await page.locator('[data-framework-panel]').all()) {
    await expect(panel).toContainText('@66hex/hasta/vue');
    await expect(panel).not.toContainText('@66hex/hasta/react');
  }

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Code framework' })).toContainText('Vue');
  const picker = page.getByRole('combobox', { name: 'Code framework' });
  await expect(page.getByRole('combobox')).toHaveCount(1);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByRole('tabpanel')).toHaveCount(0);
  await picker.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('option', { name: 'Vue', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('option', { name: 'Svelte', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker).toBeFocused();
  await expect(page.getByRole('combobox', { name: 'Code framework' })).toContainText('Svelte');
  await expect(page.locator('[data-framework-panel]').first()).toContainText('use:hastaTarget');
  await expect(page.locator('[data-framework-panel]').last()).toContainText(
    '@tanstack/svelte-query',
  );
  await selectFramework(page, 'Solid');

  for (const panel of await page.locator('[data-framework-panel]').all()) {
    await expect(panel).toContainText('@66hex/hasta/solid');
  }

  await expect(page.locator('[data-framework-panel]').first()).toContainText('ref={target.ref}');
  await expect(page.locator('[data-framework-panel]').last()).toContainText(
    '@tanstack/solid-query',
  );
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Code framework' })).toContainText('Solid');
  await expect(page.locator('[data-framework-panel]').first()).toContainText('@66hex/hasta/solid');
  await selectFramework(page, 'Vanilla');
  await expect(page.locator('[data-framework-panel]').first()).toContainText('hasta.destroy()');
  await expect(page.locator('[data-framework-panel]').last()).toContainText('@tanstack/query-core');
  await selectFramework(page, 'React');

  for (const panel of await page.locator('[data-framework-panel]').all()) {
    await expect(panel).toContainText('@66hex/hasta/react');
  }
});

test('Shiki code copies only the selected framework without toolbar text', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (value) => {
          window.copiedCode = value;
        },
      },
    });
  });
  await ready(page);
  await selectFramework(page, 'Svelte');
  const panel = page.locator('[data-framework-panel]').first();
  await expect(panel.locator('pre.shiki span[style]').first()).toBeAttached();
  await expect(panel).not.toContainText('Inbox.svelte');
  await panel.getByRole('button', { name: 'Copy code' }).click();
  await expect(panel.getByRole('status')).toHaveText('Copied');
  await expect(panel.locator('[data-visible=true]')).toHaveCount(1);
  const copied = await page.evaluate(() => window.copiedCode);
  expect(copied).toContain('@66hex/hasta/svelte');
  expect(copied).not.toContain('@66hex/hasta/react');
  expect(copied).not.toContain('Copied');
});

test('clipboard rejection gives usable feedback', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('Clipboard denied');
        },
      },
    });
  });
  await ready(page);
  const panel = page.locator('[data-framework-panel]').first();
  await panel.getByRole('button', { name: 'Copy code' }).click();
  await expect(panel.getByRole('status')).toHaveText(
    'Could not copy. Select the code and copy it manually.',
  );
});

test('section links work on a fresh visit and every internal anchor resolves', async ({ page }) => {
  await page.goto('/#intersection-event');
  const heading = page.locator('#intersection-event');
  await expect(heading).toBeInViewport();
  await expect.poll(async () => (await heading.boundingBox()).y).toBeGreaterThanOrEqual(0);

  const missing = await page.locator('a[href^="#"]').evaluateAll((links) =>
    links.flatMap((link) => {
      const id = decodeURIComponent(link.getAttribute('href').slice(1));

      return document.querySelector(`#${CSS.escape(id)}`) ? [] : [id];
    }),
  );

  expect(missing).toEqual([]);

  const ids = await page
    .locator('[id]')
    .evaluateAll((elements) => elements.map((element) => element.id));

  expect(new Set(ids).size).toBe(ids.length);
});

test('theme preference survives reload and can be toggled', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await ready(page);
  await page.locator('header').getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.reload();
  await expect(
    page.locator('header').getByRole('button', { name: 'Switch to light theme' }),
  ).toBeVisible();

  await page.locator('header').getByRole('button', { name: 'Switch to light theme' }).click();
  await expect(page.locator('html')).not.toHaveClass('dark');
});

test('invalid or unavailable storage does not prevent reading the document', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('hasta.framework', 'not-a-framework');
    Storage.prototype.setItem = () => {
      throw new Error('Storage blocked');
    };
  });
  await ready(page);
  await expect(page.getByRole('combobox', { name: 'Code framework' })).toContainText('React');
  await selectFramework(page, 'Vue');
  await expect(page.locator('[data-framework-panel]').first()).toContainText('@66hex/hasta/vue');
});
