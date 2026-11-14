import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function ready(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.evaluate(() => document.fonts.ready);
}

function region(page, kind) {
  return kind === 'code'
    ? page.locator('[data-framework-panel]').first().getByRole('region', { name: 'Code block' })
    : page.getByRole('region', { name: 'Scrollable table' }).first();
}

function card(viewport) {
  return viewport.locator('xpath=ancestor::*[@data-slot="card"]');
}

async function scrollTo(viewport, position) {
  await viewport.evaluate((element, value) => {
    element.scrollLeft = value === 'end' ? element.scrollWidth : value;
  }, position);
}

for (const kind of ['code', 'table']) {
  test(`${kind}: masks follow the hidden content and shrink near either edge`, async ({ page }) => {
    await ready(page);
    const viewport = region(page, kind);
    await expect(viewport).toHaveAttribute('tabindex', '0');
    await expect(viewport).not.toHaveAttribute('data-overflow-x-start');
    await expect(viewport).toHaveAttribute('data-overflow-x-end');
    await expect(viewport).toHaveCSS('mask-image', /0px.*100% - 24px/u);

    const maximum = await viewport.evaluate((element) => element.scrollWidth - element.clientWidth);
    await scrollTo(viewport, maximum / 2);
    await expect(viewport).toHaveCSS('mask-image', /24px.*100% - 24px/u);

    await scrollTo(viewport, 10);
    await expect(viewport).toHaveCSS('mask-image', /10px.*100% - 24px/u);
    await scrollTo(viewport, maximum - 10);
    await expect(viewport).toHaveCSS('mask-image', /24px.*100% - 10px/u);

    await scrollTo(viewport, 'end');
    await expect(viewport).toHaveAttribute('data-overflow-x-start');
    await expect(viewport).not.toHaveAttribute('data-overflow-x-end');
    await expect(viewport).toHaveCSS('mask-image', /24px.*100%(?: - 0px)?/u);

    await scrollTo(viewport, 0.5);
    await expect(viewport).not.toHaveAttribute('data-overflow-x-start');
    await scrollTo(viewport, maximum - 0.5);
    await expect(viewport).not.toHaveAttribute('data-overflow-x-end');
  });

  test(`${kind}: resizing removes overflow, masks, scrollbars, and the extra tab stop`, async ({
    page,
  }) => {
    await ready(page);
    const viewport = region(page, kind);

    if (kind === 'table') {
      // Keep table styling while making the fit independent of documentation text and fonts
      await viewport.locator('table').evaluate((table) => {
        table.style.minWidth = '480px';

        for (const cell of table.querySelectorAll('th, td')) {
          cell.textContent = cell.tagName === 'TH' ? 'Column' : 'Value';
        }
      });
    }

    await expect
      .poll(() => viewport.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBeGreaterThan(0);
    await scrollTo(viewport, 'end');
    await expect(viewport).toHaveAttribute('tabindex', '0');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollWidth - element.clientWidth))
      .toBe(0);
    await expect(viewport).toHaveAttribute('tabindex', '-1');
    await expect(viewport).not.toHaveAttribute('data-scrollable');
    await expect(viewport).toHaveCSS('mask-image', 'none');
    await expect(card(viewport).locator('[data-slot="scroll-area-scrollbar"]')).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(viewport).toHaveAttribute('tabindex', '0');
    await expect(viewport).toHaveAttribute('data-overflow-x-end');
    await expect(viewport).not.toHaveAttribute('data-overflow-x-start');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  });

  test(`${kind}: keyboard scrolling focuses the card and leaves the content out of tab order`, async ({
    page,
    browserName,
  }) => {
    await ready(page);
    const viewport = region(page, kind);
    const next = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
    const previous = browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab';
    await expect(viewport).toHaveAttribute('tabindex', '0');
    await viewport.focus();
    await page.keyboard.press(previous);
    await page.keyboard.press(next);
    await expect(viewport).toBeFocused();
    // WebKit needs a held key to start its native scroll animation
    await page.keyboard.press('ArrowRight', { delay: 50 });
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    await expect(card(viewport)).toHaveCSS('box-shadow', /3px/u);
    await expect(viewport).toHaveCSS('box-shadow', 'none');

    if (kind === 'code') {
      await expect(viewport.locator('pre')).toHaveAttribute('tabindex', '-1');
      await expect(viewport.locator('pre')).toHaveCSS('box-shadow', 'none');
    } else {
      await expect(viewport.locator('[data-slot="table-container"]')).toHaveCSS(
        'overflow-x',
        'visible',
      );
    }

    await page.keyboard.press(next);
    await expect(viewport).not.toBeFocused();
    await expect(page.locator(':focus')).toBeInViewport();
  });
}

test('content changes recalculate overflow without resizing the page', async ({ page }) => {
  await ready(page);
  const viewport = page.getByRole('region', { name: 'Code block' }).first();
  await expect(viewport).toHaveAttribute('tabindex', '-1');
  await expect(viewport).toHaveCSS('mask-image', 'none');
  const code = viewport.locator('code');
  const original = await code.innerHTML();
  await code.evaluate((element) => {
    element.textContent = 'a'.repeat(180);
  });
  await expect(viewport).toHaveAttribute('tabindex', '0');
  await expect(viewport).toHaveAttribute('data-overflow-x-end');
  await scrollTo(viewport, 'end');
  await code.evaluate((element, html) => {
    element.innerHTML = html;
  }, original);
  await expect(viewport).toHaveAttribute('tabindex', '-1');
  await expect(viewport).toHaveCSS('mask-image', 'none');
  await expect(card(viewport).locator('[data-slot="scroll-area-scrollbar"]')).toHaveCount(0);
});

test('horizontal wheel and scrollbar dragging move content while vertical wheel moves the page', async ({
  page,
}) => {
  await ready(page);
  const viewport = region(page, 'table');
  await viewport.scrollIntoViewIfNeeded();
  await viewport.hover();
  await page.mouse.wheel(100, 0);
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  await scrollTo(viewport, 0);
  const thumb = card(viewport).locator('[data-slot="scroll-area-thumb"]');
  await expect(thumb).toBeVisible();
  const box = await thumb.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 65, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(40);

  await viewport.hover();
  const before = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 220);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 100);
});

test('framework changes reset masks and copying stays fixed outside the scrolling content', async ({
  page,
}) => {
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

  for (const framework of ['Vanilla', 'Vue', 'Svelte', 'React']) {
    await page.getByRole('combobox', { name: 'Code framework' }).click();
    await page.getByRole('option', { name: framework, exact: true }).click();
    const viewport = region(page, 'code');
    await expect(viewport).not.toHaveAttribute('data-overflow-x-start');
    await expect(viewport).toHaveAttribute('data-overflow-x-end');
    const copy = card(viewport).getByRole('button', { name: 'Copy code', exact: true });
    await copy.scrollIntoViewIfNeeded();
    const before = await copy.boundingBox();
    await scrollTo(viewport, 'end');
    await expect(viewport).toHaveAttribute('data-overflow-x-start');
    const after = await copy.boundingBox();
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    await expect(card(viewport)).toHaveCSS('mask-image', 'none');
    await copy.click();
    const expected = await viewport.locator('code').textContent();
    expect(await page.evaluate(() => window.copiedCode)).toBe(expected);
  }
});

test('overflowing code and tables remain accessible on mobile in both themes', async ({ page }) => {
  await ready(page);

  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') {
      await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    }

    await page.evaluate(async () => {
      await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
    });

    const result = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();

    expect(result.violations).toEqual([]);
  }
});
