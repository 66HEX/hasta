import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function ready(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('hasta');
}

async function selectFramework(page, name) {
  await page.getByRole('combobox', { name: 'Code framework' }).click();
  await page.getByRole('option', { name, exact: true }).click();
}

async function approachInbox(page, demo) {
  await demo.scrollIntoViewIfNeeded();
  const box = await demo.locator('[data-demo-stage]').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + 260);

  for (let step = 0; step < 18; step++) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + 250 - step * 5);
    await page.waitForTimeout(16);
  }
}

async function expectNoOverflow(page) {
  const sizes = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
  }));

  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport + 1);
}

test('one complete document has no routing, search, or table of contents', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await expect(page).toHaveTitle('Hasta · A little ahead of the pointer');
  await expect(page.getByRole('link', { name: 'Hasta home' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.locator('main h1')).toHaveCount(0);
  await expect(
    page.getByRole('region', { name: 'Introduction' }).locator(':scope > p').first(),
  ).toContainText('Hasta is a JavaScript library');

  for (const id of ['usage', 'use-cases', 'how-it-works', 'api-reference']) {
    await expect(page.locator(`#${id}`)).toBeAttached();
  }

  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(4);
  await expect(page.locator('[data-demo="prediction"]')).toHaveCount(1);

  await expect(page.getByRole('search')).toHaveCount(0);
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /search/iu })).toHaveCount(0);
  await expect(page.locator('a[href^="/docs"], a[href="/examples"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(errors).toEqual([]);
});

test('the portfolio frame aligns its solid rails, dashed column, and full-width dividers', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await ready(page);
  await page.evaluate(() => document.fonts.ready);

  const frame = page.locator('.page-frame');
  const column = page.locator('.page-column');
  expect(await frame.boundingBox()).toMatchObject({ x: 336, y: 0, width: 768 });
  expect(await column.boundingBox()).toMatchObject({ x: 384, y: 0, width: 672 });
  await expect(frame).toHaveCSS('border-left-style', 'solid');
  await expect(column).toHaveCSS('border-left-style', 'dashed');

  for (const selector of ['header', 'main', 'article', 'footer', '[data-layout-surface]']) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box.x).toBe(385);
    expect(box.width).toBe(670);
  }

  const divider = await page
    .locator('[data-layout-surface]')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element, '::before');

      return { width: style.width, border: style.borderTopStyle };
    });

  expect(divider).toEqual({ width: '766px', border: 'dashed' });

  const roundedComponents = await page
    .locator('[data-slot]')
    .evaluateAll((elements) =>
      elements
        .filter((element) => getComputedStyle(element).borderRadius !== '0px')
        .map((element) => element.dataset.slot),
    );

  expect(roundedComponents).toEqual([]);

  const styles = await page.locator('article').evaluate((element) => {
    const prose = getComputedStyle(element);
    const heading = getComputedStyle(element.querySelector('h2'));

    return {
      font: prose.fontFamily,
      size: prose.fontSize,
      line: Number(prose.lineHeight.replace('px', '')),
      weight: heading.fontWeight,
    };
  });

  expect(styles).toMatchObject({ size: '14px', weight: '400' });
  expect(styles.line).toBe(22.75);
  expect(styles.font).toContain('Departure Mono');
});

test('shared layout edges have exactly one separator in both themes', async ({ page }) => {
  await ready(page);
  await page.evaluate(() => document.fonts.ready);

  for (const theme of ['light', 'dark']) {
    await page.evaluate(
      (theme) => document.documentElement.classList.toggle('dark', theme === 'dark'),
      theme,
    );

    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 1000 });

      const dividers = await page.locator('.layout-band').evaluateAll((elements) => {
        const lines = [];

        for (const element of elements) {
          const box = element.getBoundingClientRect();

          for (const pseudo of ['::before', '::after']) {
            const style = getComputedStyle(element, pseudo);

            if (style.content === 'none') {
              continue;
            }

            const position = box.top + Number(style.top.replace('px', ''));
            lines.push(Number(position.toFixed(2)));
          }
        }

        return lines;
      });

      expect(new Set(dividers).size, `${theme} at ${width}px`).toBe(dividers.length);

      const sharedEdges = await page
        .locator('header, [data-heading]:has(#usage)')
        .evaluateAll((elements) =>
          elements.map((element) => element.getBoundingClientRect().bottom - 1),
        );

      for (const edge of sharedEdges) {
        expect(dividers.filter((position) => Math.abs(position - edge) < 0.01)).toHaveLength(1);
      }
    }
  }
});

test('the header framework choice updates all examples and persists on reload', async ({
  page,
}) => {
  await ready(page);
  await selectFramework(page, 'Vue');
  await expect(page.locator('[data-framework-panel]')).toHaveCount(2);

  for (const panel of await page.locator('[data-framework-panel]').all()) {
    await expect(panel).toContainText('hasta/vue');
    await expect(panel).not.toContainText('hasta/react');
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
  await selectFramework(page, 'Vanilla');
  await expect(page.locator('[data-framework-panel]').first()).toContainText('hasta.destroy()');
  await expect(page.locator('[data-framework-panel]').last()).toContainText('@tanstack/query-core');
  await selectFramework(page, 'React');

  for (const panel of await page.locator('[data-framework-panel]').all()) {
    await expect(panel).toContainText('hasta/react');
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
  await expect(panel.getByRole('button', { name: 'Copy code' })).toHaveCSS('position', 'absolute');
  await panel.getByRole('button', { name: 'Copy code' }).click();
  await expect(panel.getByRole('status')).toHaveText('Copied');
  await expect(panel.locator('[data-visible=true]')).toHaveCount(1);
  await expect(panel.locator('[data-visible=true]')).toHaveCSS('transition-duration', '0.2s');
  const copied = await page.evaluate(() => window.copiedCode);
  expect(copied).toContain('hasta/svelte');
  expect(copied).not.toContain('hasta/react');
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

test('theme preference survives reload and changes syntax colors', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await ready(page);
  await page.locator('header').getByRole('button', { name: 'Switch to dark theme' }).click();
  await expect(page.locator('html')).toHaveClass('dark');
  await page.reload();
  await expect(
    page.locator('header').getByRole('button', { name: 'Switch to light theme' }),
  ).toBeVisible();

  const token = page
    .locator('[data-framework-panel]')
    .first()
    .locator('pre.shiki span[style]')
    .first();

  const darkColor = await token.evaluate((element) => getComputedStyle(element).color);
  await page.locator('header').getByRole('button', { name: 'Switch to light theme' }).click();
  const lightColor = await token.evaluate((element) => getComputedStyle(element).color);
  expect(darkColor).not.toBe(lightColor);
});

test('saved preferences survive the rename and new choices take precedence', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('futura.framework', 'vue');
    localStorage.setItem('futura.theme', 'dark');
  });
  await ready(page);
  await expect(page.getByRole('combobox', { name: 'Code framework' })).toContainText('Vue');
  await expect(page.locator('html')).toHaveClass('dark');
  await selectFramework(page, 'Svelte');
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Code framework' })).toContainText('Svelte');
  await expect(page.locator('html')).not.toHaveClass('dark');
  expect(
    await page.evaluate(() => ({
      framework: localStorage.getItem('hasta.framework'),
      theme: localStorage.getItem('hasta.theme'),
    })),
  ).toEqual({ framework: 'svelte', theme: 'light' });
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
  await expect(page.locator('[data-framework-panel]').first()).toContainText('hasta/vue');
});

test('live input triggers the real engine and changing framework preserves the result', async ({
  page,
}) => {
  await ready(page);
  const demo = page.locator('[data-demo="prediction"]');
  await approachInbox(page, demo);
  await expect(demo.locator('figcaption')).toContainText(/Inbox predicted \d+ ms before entry/u);
  const result = await demo.locator('figcaption').textContent();
  await selectFramework(page, 'Vue');
  await expect(demo.locator('figcaption')).toHaveText(result);
});

test('live mouse movement forecasts a target and departure cancels the match', async ({ page }) => {
  await ready(page);
  const demo = page.locator('[data-demo="prediction"]');
  await demo.scrollIntoViewIfNeeded();
  const box = await demo.locator('[data-demo-stage]').boundingBox();
  await page.mouse.move(box.x + box.width * 0.5, box.y + 260);

  for (let step = 0; step < 18; step++) {
    await page.mouse.move(box.x + box.width * 0.5, box.y + 250 - step * 5);
    await page.waitForTimeout(16);
  }

  await expect(demo.locator('figcaption')).toContainText('Inbox predicted');
  await page.mouse.move(0, 0);
  await expect(demo.locator('[data-predicted="true"]')).toHaveCount(0);
});

test('the library debug overlay is the only inspection layer and can be disabled', async ({
  page,
}) => {
  await ready(page);
  const demo = page.locator('[data-demo="prediction"]');
  await demo.getByRole('switch', { name: 'Show the library debug overlay' }).check();
  await approachInbox(page, demo);
  await expect(page.locator('[data-hasta-bounds]')).toHaveCount(4);
  await expect(demo.locator('[data-demo-bounds]')).toHaveCount(0);
  await expect(demo.getByRole('switch', { name: 'Inspect', exact: true })).toHaveCount(0);

  for (const host of await page.locator('[data-hasta-debug]').all()) {
    await expect(host).toHaveAttribute('aria-hidden', 'true');
    await expect(host).toHaveCSS('pointer-events', 'none');
  }

  await demo.getByRole('switch', { name: 'Show the library debug overlay' }).uncheck();
  await expect(page.locator('[data-hasta-bounds]')).toHaveCount(0);
});

test('Markdown tables, code, and previews share shadcn cards', async ({ page }) => {
  await ready(page);

  for (const tag of [
    'h2',
    'h3',
    'p',
    'a',
    'strong',
    'pre',
    'table',
    'thead',
    'tbody',
    'th',
    'td',
  ]) {
    expect(await page.locator(`[data-mdx="${tag}"]`).count(), tag).toBeGreaterThan(0);
  }

  await expect(page.locator('[data-slot="table"]')).toHaveCount(
    await page.locator('table').count(),
  );

  const surfaces = await page.locator('table, pre, [data-demo-stage]').evaluateAll((elements) =>
    elements.map((element) => {
      const card = element.closest('[data-slot="card"]');
      const content = element.closest('[data-slot="card-content"]');
      const frame = element.closest('[data-layout-surface]');
      const cardBox = card.getBoundingClientRect();
      const frameBox = frame.getBoundingClientRect();

      return {
        table: element.tagName === 'TABLE',
        card: card !== null,
        content: content !== null,
        padding: content ? getComputedStyle(content).paddingInlineStart : null,
        framePadding: getComputedStyle(frame).padding,
        fillsFrame:
          cardBox.x === frameBox.x &&
          cardBox.width === frameBox.width &&
          cardBox.height === frameBox.height,
        border: getComputedStyle(card).borderWidth,
        radius: getComputedStyle(card).borderRadius,
        ring: getComputedStyle(card).getPropertyValue('--tw-ring-shadow'),
      };
    }),
  );

  for (const surface of surfaces) {
    expect(surface).toEqual({
      table: surface.table,
      card: true,
      content: true,
      padding: surface.table ? '0px' : '16px',
      framePadding: '0px',
      fillsFrame: true,
      border: '0px',
      radius: '0px',
      ring: expect.stringContaining('0px'),
    });
  }
});

test('shadcn sliders support keyboard tuning and expose updated values', async ({ page }) => {
  await ready(page);
  const demo = page.locator('[data-demo="prediction"]');
  const horizon = demo.getByRole('slider', { name: 'Look ahead' });
  const margin = demo.getByRole('slider', { name: 'Target margin' });
  await horizon.focus();
  await horizon.press('ArrowRight');
  await expect(horizon).toHaveAttribute('aria-valuenow', '170');
  await margin.focus();
  await margin.press('Home');
  await expect(margin).toHaveAttribute('aria-valuenow', '0');
  await margin.press('End');
  await expect(margin).toHaveAttribute('aria-valuenow', '40');
  await approachInbox(page, demo);
  await expect(demo.locator('figcaption')).toContainText('predicted');
});

test('mobile width stays bounded for every framework and long tables', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);

  for (const selector of ['header', 'main', 'article', 'footer']) {
    const box = await page.locator(selector).first().boundingBox();
    expect(box.x).toBe(0);
    expect(box.width).toBe(390);
  }

  for (const framework of ['React', 'Vanilla', 'Vue', 'Svelte']) {
    await selectFramework(page, framework);
    await expectNoOverflow(page);
  }

  await expectNoOverflow(page);
  const pre = page.locator('[data-framework-panel]').first().locator('pre');
  await expect(pre).toHaveAttribute('tabindex', '-1');
  const viewport = page.locator('[data-framework-panel]').first().getByRole('region');
  await viewport.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  expect(await viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  expect(await viewport.evaluate((element) => element.scrollWidth)).toBeGreaterThan(
    await viewport.evaluate((element) => element.clientWidth),
  );
});

test('reduced motion preserves keyboard access to inspection controls', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await ready(page);
  const demo = page.locator('[data-demo="prediction"]');
  const debug = demo.getByRole('switch', { name: 'Show the library debug overlay' });
  await debug.focus();
  await page.keyboard.press('Space');
  await expect(debug).toBeChecked();
  await expect(debug).toBeFocused();
  await expect(demo.getByRole('button', { name: /play|stop/iu })).toHaveCount(0);
});

test('document and framework picker pass accessibility checks in both themes', async ({ page }) => {
  await ready(page);

  const light = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();

  expect(light.violations).toEqual([]);
  await page.locator('header').getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.evaluate(async () => {
    await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
  });
  const dark = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(dark.violations).toEqual([]);
  await page.getByRole('combobox', { name: 'Code framework' }).click();

  await page.evaluate(async () => {
    await Promise.allSettled(document.getAnimations().map((animation) => animation.finished));
  });

  const picker = await new AxeBuilder({ page })
    // VoiceOver needs these unnamed focus sentinels: floating-ui/floating-ui#2823
    .exclude('[data-base-ui-focus-guard]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();

  expect(picker.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('combobox', { name: 'Code framework' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.locator('header').getByRole('button', { name: 'Switch to light theme' }),
  ).toBeFocused();
});
