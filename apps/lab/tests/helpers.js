import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

import { expect } from '@playwright/test';

import { checksum } from '../src/checksum.ts';
import { importSession } from '../src/data.ts';

export async function downloadSession(page, name = 'Download backup') {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name, exact: true }).click();
  const download = await pending;
  const buffer = await readFile(await download.path());
  const session = await importSession(gunzipSync(buffer).toString('utf8'));

  return { session, buffer, download };
}

export async function uploadSession(page, session) {
  const previous = await page.evaluate(() => localStorage.getItem('hasta.lab.session'));
  const sha256 = await checksum(JSON.stringify(session));
  await page.getByLabel('Recording backup file').setInputFiles({
    name: 'session.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify({ schemaVersion: 2, protocol: 'hasta-intent-5p-v3', sha256, session }),
    ),
  });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('hasta.lab.session')))
    .not.toBe(previous);
  await expect(page.locator('.save-status')).toHaveText('Saved on this device');
}

export async function openSession(page, participant = 'P01', device = 'Mouse') {
  await page.goto(`/?participant=${participant}`);
  await expect(page.getByRole('combobox', { name: 'Input device', exact: true })).toBeEnabled();
  await page.getByRole('combobox', { name: 'Input device', exact: true }).click();
  await page.getByRole('option', { name: device, exact: true }).click();
  await page.getByRole('button', { name: 'Open session' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('heading', { name: 'Practice 1 of 12' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
}

export async function resume(page) {
  await page.getByRole('button', { name: /^I am P/u }).click();
}

export async function center(locator) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();

  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function moveTo(page, from, to) {
  for (let step = 1; step <= 16; step++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * step) / 16,
      from.y + ((to.y - from.y) * step) / 16,
    );
    await page.waitForTimeout(12);
  }
}

export async function completeTask(page) {
  const startButton = page.getByRole('button', { name: 'Start', exact: true });
  await expect(startButton).toBeEnabled();
  const start = await center(startButton);
  const intended = await page.locator('.study-board').getAttribute('data-intended');

  const destination = await center(
    page.locator(intended === 'none' ? '[data-gate]' : `[data-target="${intended}"]`),
  );

  await page.mouse.click(start.x, start.y);

  if (intended === 'none') {
    await expect(page.getByRole('button', { name: 'Finish', exact: true })).toBeDisabled();
  }

  await moveTo(page, start, destination);

  if (intended === 'none') {
    const finish = page.getByRole('button', { name: 'Finish', exact: true });
    await expect(finish).toBeEnabled();
    const end = await center(finish);
    await moveTo(page, destination, end);
    await page.mouse.click(end.x, end.y);
  } else {
    await page.mouse.click(destination.x, destination.y);
  }

  await expect(page.locator('.save-status')).toHaveText('Saved on this device');
}
