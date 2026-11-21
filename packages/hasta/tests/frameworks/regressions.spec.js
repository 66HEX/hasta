import { expect, test } from '@playwright/test';

test('react rollback and vue invalid ref regressions behave consistently', async ({ page }) => {
  await page.goto('/regressions.html');
  await page.waitForFunction(() => 'runFrameworkRegressions' in window);

  const result = await page.evaluate(() =>
    window.runFrameworkRegressions(
      (ref) => ref(),
      (ref, value) => ref(value),
    ),
  );

  expect(result).toEqual({
    reactHadButton: true,
    reactInvalidError: 'TypeError:Target refs require an HTMLElement, SVGElement, or null.',
    switchError: null,
    switchedBoundsWidth: 120,
    vueUndefinedError:
      'TypeError:Hasta target refs require an HTMLElement or SVGElement, not a Vue component instance.',
    vueNumberError:
      'TypeError:Hasta target refs require an HTMLElement or SVGElement, not a Vue component instance.',
  });
});

test('solid handles undefined ref and controller switch during deferred attach', async ({
  page,
}) => {
  await page.goto('/solid-regressions.html');
  await page.waitForFunction(() => 'runSolidRegressions' in window);

  const result = await page.evaluate(() => window.runSolidRegressions((ref) => ref()));

  expect(result).toEqual({
    undefinedError: 'TypeError:Target refs require an HTMLElement, SVGElement, or null.',
    switchError: null,
    boundsWidthAfterAdopt: 90,
  });
});
