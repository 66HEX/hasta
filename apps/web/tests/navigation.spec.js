import { expect, test } from '@playwright/test';

async function clipboard(page, reject = false) {
  await page.addInitScript((shouldReject) => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async (value) => {
          if (shouldReject) {
            throw new Error('Clipboard unavailable');
          }

          window.copiedLink = value;
        },
      },
    });
  }, reject);
}

test('heading anchor matches the reference position, tooltip, and copy behavior', async ({
  page,
}) => {
  await clipboard(page);
  await page.goto('/?source=share#how-it-works');
  const heading = page.locator('#usage');
  const row = page.locator('[data-heading]').filter({ has: heading });
  const button = row.getByRole('button');
  await heading.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await expect(button).toHaveCSS('opacity', '0');
  await heading.hover();
  await expect(button).toHaveCSS('opacity', '1');
  const text = await heading.boundingBox();
  const anchor = await button.boundingBox();
  expect(anchor.x - text.x - text.width).toBeCloseTo(8, 1);
  expect(anchor.width).toBe(28);
  expect(anchor.height).toBe(28);
  expect(anchor.y + anchor.height / 2).toBeCloseTo(text.y + text.height / 2, 1);
  await button.hover();
  const tooltip = page.locator('[data-slot="tooltip-content"]');
  await expect(tooltip).toHaveText('Copy link to this section');
  await expect(tooltip).toHaveAttribute('data-side', 'top');
  const url = page.url();
  const scroll = await page.evaluate(() => scrollY);
  await button.click();
  await expect(button).toHaveAttribute('data-copied', 'true');
  await expect(tooltip).toHaveText('Section link copied');
  await expect(row.getByRole('status')).toHaveText('Section link copied');
  expect(await page.evaluate(() => window.copiedLink)).toBe(
    new URL('/?source=share#usage', url).href,
  );
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => scrollY)).toBe(scroll);
  await expect(button).toHaveAttribute('data-copied', 'false');
  await expect(tooltip).toHaveText('Copy link to this section');
  await page.keyboard.press('Escape');
  await expect(tooltip).toHaveCount(0);
});

test('heading copy is keyboard accessible and clipboard failure keeps focus', async ({ page }) => {
  await clipboard(page, true);
  await page.goto('/');
  const button = page.locator('[data-heading-anchor]').first();
  await button.focus();
  await expect(button).toHaveCSS('opacity', '1');
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
    'Copy link to this section',
  );
  await page.keyboard.press('Enter');
  await expect(button).toBeFocused();
  await expect(button).toHaveAttribute('data-copied', 'false');
  await expect(button).toHaveAccessibleName('Could not copy section link');
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
    'Could not copy section link',
  );
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
  await expect(button).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Copy code', exact: true }).first()).toBeFocused();
});

test('Tab visits visible controls and gives slider thumbs a visible focus ring', async ({
  page,
  browserName,
}) => {
  await page.goto('/');
  await page.getByRole('heading', { level: 1 }).waitFor();
  // WebKit on macOS uses Option+Tab to include links in keyboard navigation
  const next = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  const previous = browserName === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab';
  await page.mouse.move(0, 0);
  const visited = [];

  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press(next);
    const thumb = page.locator('[data-slot="slider-thumb"]:focus-within');
    const focused = (await thumb.count()) > 0 ? thumb : page.locator(':focus');
    await expect(focused).toBeInViewport();

    const current = await page.evaluate(() => {
      const active = document.activeElement;
      const thumb = active.closest('[data-slot="slider-thumb"]');
      const visible = thumb ?? active;
      const style = getComputedStyle(visible);
      const rect = visible.getBoundingClientRect();

      return {
        tag: active.tagName,
        interactive:
          active.matches('a[href], button, [role="switch"], input[type="range"]') ||
          (active.matches('[data-slot="scroll-area-viewport"][data-scrollable]') &&
            active.scrollWidth > active.clientWidth),
        opacity: style.opacity,
        display: style.display,
        visibility: style.visibility,
        width: rect.width,
        height: rect.height,
        inViewport: rect.bottom > 0 && rect.top < innerHeight,
        slider: thumb !== null,
        footer: active.closest('footer') !== null,
        name: active.getAttribute('aria-label') ?? active.textContent,
      };
    });

    expect(current.interactive, JSON.stringify(current)).toBe(true);
    expect(current.opacity).toBe('1');
    expect(current.display).not.toBe('none');
    expect(current.visibility).toBe('visible');
    expect(current.width).toBeGreaterThan(0);
    expect(current.height).toBeGreaterThan(0);
    expect(current.inViewport).toBe(true);
    visited.push(current);

    if (current.slider) {
      await expect(page.locator('[data-slot="slider-thumb"]:focus-within')).toHaveCSS(
        'box-shadow',
        /3px/u,
      );
    }

    if (current.footer && current.name.includes('Back to top')) {
      break;
    }
  }

  expect(visited.at(-1)).toMatchObject({
    footer: true,
    name: expect.stringContaining('Back to top'),
  });
  expect(visited.filter((control) => control.slider)).toHaveLength(4);
  expect(visited.filter((control) => control.name === 'Code framework')).toHaveLength(1);
  await page.keyboard.press(previous);
  await expect(page.locator('footer').getByRole('link', { name: 'Marek Jóźwiak' })).toBeFocused();
});

test('skip link moves into the article and Tab continues at its first control', async ({
  page,
  browserName,
}) => {
  await page.goto('/');
  await page.getByRole('heading', { level: 1 }).waitFor();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('button', { name: 'Preview Profile' })).toBeFocused();
});
