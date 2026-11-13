import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?manual=1');
  await page.waitForFunction(() => window.ready);
});

for (const tracking of [false, true]) {
  test(`narrow overlay keeps ${tracking ? 'active' : 'idle'} labels compact without covering other labels or targets`, async ({
    page,
  }) => {
    const result = await page.evaluate((tracking) => {
      const h = window.harness;
      const hasta = h.createHasta({ debug: { panel: false } });

      const positions = [
        [51, 400],
        [229, 456],
        [51, 584],
        [229, 630],
      ];

      for (const [index, [x, y]] of positions.entries()) {
        const element = h.element({ x, y, width: 110, height: 113 });
        element.dataset.hastaLabel = ['Alfa', 'Bravo', 'Charlie', 'Delta'][index];
        hasta
          .track(element)
          .when({ type: 'intersects', withinMs: 120, marginPx: 8 }, () => {}, { cooldownMs: 180 });
      }

      if (tracking) {
        h.pointer(1000, 0, 450);
        h.pointer(1020, 20, 450);
      }

      h.frame();
      const snapshot = hasta.getDebugSnapshot();
      const shadow = document.querySelector('[data-hasta-debug]').shadowRoot;

      const labels = [...shadow.querySelectorAll('[data-hasta-target-label]')].map((label) => {
        const rect = label.querySelector('rect');
        const x = Number(rect.getAttribute('x'));
        const y = Number(rect.getAttribute('y'));

        return {
          id: Number(label.dataset.hastaTargetLabel),
          lines: label.querySelectorAll('tspan').length,
          rect: {
            minX: x,
            minY: y,
            maxX: x + Number(rect.getAttribute('width')),
            maxY: y + Number(rect.getAttribute('height')),
          },
        };
      });

      const telemetry = snapshot.targets.map((target) => ({
        rect: target.rect,
        rule: target.rules[0],
      }));

      hasta.destroy();

      return { labels, telemetry };
    }, tracking);

    const overlaps = (a, b) =>
      a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;

    expect(result.labels).toHaveLength(4);

    for (const [index, label] of result.labels.entries()) {
      expect(label.rect.minX).toBeGreaterThanOrEqual(0);
      expect(label.rect.maxX).toBeLessThanOrEqual(390);
      expect(label.rect.minY).toBeGreaterThanOrEqual(0);
      expect(label.rect.maxY).toBeLessThanOrEqual(844);

      for (const other of result.labels.slice(index + 1)) {
        expect(overlaps(label.rect, other.rect)).toBe(false);
      }

      for (const target of result.telemetry) {
        expect(overlaps(label.rect, target.rect)).toBe(false);
      }

      expect(label.lines).toBe(2);
    }

    for (const target of result.telemetry) {
      expect(target.rule).toMatchObject({ withinMs: 120, marginPx: 8, cooldownMs: 180 });
    }
  });
}
