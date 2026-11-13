import { expect, test } from '@playwright/test';

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('social crawlers receive complete metadata and a PNG using the dark theme', async ({
    page,
    request,
  }) => {
    await page.goto('/');

    const imageUrl = 'https://hasta.madebyhex.com/og.png';
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      'href',
      'https://hasta.madebyhex.com/',
    );
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', imageUrl);
    await expect(page.locator('meta[name="twitter:image"]')).toHaveAttribute('content', imageUrl);
    await expect(page.locator('meta[property="og:image:width"]')).toHaveAttribute(
      'content',
      '1200',
    );
    await expect(page.locator('meta[property="og:image:height"]')).toHaveAttribute(
      'content',
      '630',
    );
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
      'content',
      'summary_large_image',
    );

    const response = await request.get(new URL(imageUrl).pathname);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');

    const bytes = await response.body();
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(bytes.readUInt32BE(16)).toBe(1200);
    expect(bytes.readUInt32BE(20)).toBe(630);
  });
});

test('generated OG pixels match the dark theme tokens', async ({ page }) => {
  await page.goto('/');

  const samples = await page.evaluate(async () => {
    const image = new Image();
    image.src = '/og.png';
    await image.decode();

    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);

    const theme = document.createElement('div');
    theme.className = 'dark';
    document.body.append(theme);
    const style = getComputedStyle(theme);
    const results = [];

    for (const [token, x, y] of [
      ['--background', 32, 32],
      ['--card', 80, 80],
    ]) {
      const actual = [...context.getImageData(x, y, 1, 1).data];
      context.fillStyle = style.getPropertyValue(token);
      context.fillRect(0, 0, 1, 1);
      const expected = [...context.getImageData(0, 0, 1, 1).data];
      results.push({ token, actual, expected });
    }

    theme.remove();

    return results;
  });

  for (const { token, actual, expected } of samples) {
    for (let channel = 0; channel < 4; channel++) {
      expect(Math.abs(actual[channel] - expected[channel]), token).toBeLessThanOrEqual(1);
    }
  }
});

test('the OG logo matches the current SVG in the foreground color', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const theme = document.createElement('div');
    theme.className = 'dark';
    document.body.append(theme);
    const foreground = getComputedStyle(theme).getPropertyValue('--foreground');
    const source = await (await fetch('/logo.svg')).text();
    const svg = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
    svg.setAttribute('color', foreground);

    const reference = new Image();
    reference.src = `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    const image = new Image();
    image.src = '/og.png';
    await Promise.all([reference.decode(), image.decode()]);

    const canvas = document.createElement('canvas');
    canvas.width = 240;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    context.drawImage(reference, 0, 0, 240, 240);
    const expected = context.getImageData(0, 0, 240, 240).data;
    context.clearRect(0, 0, 240, 240);
    context.drawImage(image, 856, 189, 240, 240, 0, 0, 240, 240);
    const actual = context.getImageData(0, 0, 240, 240).data;
    let inkPixels = 0;
    let matchingPixels = 0;

    for (let offset = 0; offset < expected.length; offset += 4) {
      if (expected[offset + 3] !== 255) {
        continue;
      }

      inkPixels++;

      if (
        Math.abs(actual[offset] - expected[offset]) <= 2 &&
        Math.abs(actual[offset + 1] - expected[offset + 1]) <= 2 &&
        Math.abs(actual[offset + 2] - expected[offset + 2]) <= 2
      ) {
        matchingPixels++;
      }
    }

    theme.remove();

    return { inkPixels, matchingPixels };
  });

  expect(result.inkPixels).toBeGreaterThan(1000);
  expect(result.matchingPixels / result.inkPixels).toBeGreaterThan(0.99);
});
