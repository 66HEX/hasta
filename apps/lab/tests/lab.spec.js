import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import { examplesFor } from '../src/features.ts';
import { completeTask, downloadSession, openSession, resume, uploadSession } from './helpers.js';

test('captures raw motion and Hasta, resumes and imports a checked backup', async ({ page }) => {
  await openSession(page);
  await completeTask(page);
  const { session } = await downloadSession(page);
  const trial = session.trials[0];
  expect(session.protocolVersion).toBe(3);
  expect(session.collection.warmupNext).toBe(1);
  expect(trial.quality.eligible).toBe(true);
  expect(trial.samples.length).toBeGreaterThan(10);
  expect(trial.frames.length).toBeGreaterThan(0);
  expect(trial.context.end).not.toBeNull();
  expect(
    trial.frames.every((frame) => frame.measuredAt <= frame.at && frame.at <= trial.duration),
  ).toBe(true);
  await page.reload();
  await resume(page);
  await expect(page.getByRole('heading', { name: 'Practice 2 of 12' })).toBeVisible();
  expect((await downloadSession(page)).session.trials).toEqual(session.trials);
  await uploadSession(page, session);
  await resume(page);
  const restored = (await downloadSession(page)).session;
  expect(restored.collection.recordingId).toBe(session.collection.recordingId);
  expect(restored.id).not.toBe(session.id);
  expect(restored.trials).toEqual(session.trials);
});

test('retains interruption and timeout, with one retry per planned task', async ({ page }) => {
  await openSession(page, 'P02', 'Touchpad');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Retry task' }).click();
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Next task' })).toBeVisible({ timeout: 7000 });
  const { session } = await downloadSession(page);
  expect(session.device).toBe('trackpad');
  expect(session.collection.warmupNext).toBe(1);
  expect(session.trials.map((trial) => trial.outcome)).toEqual(['interrupted', 'timeout']);
  expect(session.trials.map((trial) => trial.context.attempt)).toEqual([1, 2]);
  expect(session.trials.every((trial) => !trial.quality.eligible)).toBe(true);
});

test('recovers a closed recording and blocks a second collection tab', async ({
  page,
  context,
}) => {
  await openSession(page);
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByRole('alert')).toContainText('Close other collection tabs');
  await expect(second.getByRole('button', { name: 'Open session' })).toBeDisabled();
  await second.close();
  await page.bringToFront();
  await page.evaluate(() => {
    // Simulate abrupt termination without allowing graceful interruption handlers to save first
    for (const [target, type] of [
      [window, 'blur'],
      [document, 'visibilitychange'],
      [document, 'pointerout'],
    ]) {
      target.addEventListener(type, (event) => event.stopImmediatePropagation(), { capture: true });
    }
  });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.reload();
  await resume(page);
  const { session } = await downloadSession(page);
  expect(session.trials).toHaveLength(1);
  expect(session.trials[0].outcome).toBe('interrupted');
  expect(session.trials[0].reason).toContain('page closed');
  expect(session.collection.warmupNext).toBe(0);
  await expect(page.getByRole('heading', { name: 'Practice 1 of 12' })).toBeVisible();
});

test('stops on failed saving and retains the attempt for backup and retry', async ({ page }) => {
  await openSession(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let failed = false;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.name === 'sessions' && !failed) {
        failed = true;
        const request = original.apply(this, args);
        this.transaction.abort();

        return request;
      }

      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry task' })).toBeDisabled();
  expect((await downloadSession(page)).session.trials).toHaveLength(1);
  await page.getByRole('button', { name: 'Retry saving' }).click();
  await expect(page.getByRole('button', { name: 'Retry task' })).toBeEnabled();
  await page.reload();
  await resume(page);
  expect((await downloadSession(page)).session.trials).toHaveLength(1);
});

test('records a complete session with all five checkpoints and exports training input', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Full-length collection is exercised once; browser recording checks run everywhere.',
  );
  test.setTimeout(240_000);
  await openSession(page);

  for (let index = 0; index < 12; index++) {
    await completeTask(page);

    if (index < 11) {
      await page.getByRole('button', { name: 'Next task' }).click();
    }
  }

  await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
  await page.getByRole('button', { name: 'Begin collection' }).click();

  for (let index = 0; index < 120; index++) {
    await completeTask(page);

    if ((index + 1) % 24 !== 0) {
      await page.getByRole('button', { name: 'Next task' }).click();
      continue;
    }

    const final = index === 119;

    const { session, download } = await downloadSession(
      page,
      final ? 'Download final backup' : 'Download block backup',
    );

    expect(session.nextIndex).toBe(index + 1);
    expect(session.trials).toHaveLength(index + 13);
    expect(session.trials.every((trial) => trial.quality.eligible)).toBe(true);

    if (final) {
      expect(session.environment.automated).toBe(true);
      expect(session.trials.flatMap(examplesFor).length).toBeGreaterThan(500);
      expect(session.trials.some((trial) => trial.callbacks.length > 0)).toBe(true);
      const artifacts = resolve('../../docs/artifacts');
      await mkdir(artifacts, { recursive: true });
      await download.saveAs(resolve(artifacts, 'automated-collection.json.gz'));
    }

    await page.getByRole('checkbox').check();
    await page
      .getByRole('button', { name: final ? 'Finish session' : 'Continue to next block' })
      .click();
  }

  await expect(page.getByRole('heading', { name: 'Session complete', exact: true })).toBeVisible();
});

test('fits a laptop viewport, keeps the picker legible, and supports both themes', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openSession(page);
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
  const board = await page.locator('.study-board').boundingBox();
  expect(board.width).toBeGreaterThanOrEqual(580);
  expect(board.height).toBeGreaterThanOrEqual(440);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(720);
  await page.getByRole('combobox', { name: 'Saved session', exact: true }).click();
  const option = page.getByRole('option', { name: /P01/u });
  expect(
    await option
      .locator('.option-content')
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('.lab-select-content:visible')).toHaveCount(0);

  if (!(process.platform === 'darwin' && testInfo.project.name === 'firefox')) {
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }

  await page.getByRole('button', { name: /Switch to .* theme/u }).click();
  await page.evaluate(() =>
    Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))),
  );

  if (!(process.platform === 'darwin' && testInfo.project.name === 'firefox')) {
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  }

  await page.screenshot({ path: testInfo.outputPath('collection.png') });
});

test('completes practice on a touchpad profile, including gates, and requires confirmation after reload', async ({
  page,
}) => {
  await openSession(page, 'P03', 'Touchpad');

  for (let index = 0; index < 12; index++) {
    await completeTask(page);

    if (index < 11) {
      await page.getByRole('button', { name: 'Next task' }).click();
    }
  }

  await expect(page.getByRole('heading', { name: 'Practice complete' })).toBeVisible();
  const { session } = await downloadSession(page);
  expect(session.trials.filter((trial) => trial.outcome === 'none')).toHaveLength(3);
  expect(session.trials.every((trial) => trial.quality.eligible)).toBe(true);
  await page.getByRole('button', { name: 'Begin collection' }).click();
  await expect(page.getByRole('button', { name: 'Start', exact: true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Resume session 1 · P03' })).toBeVisible();
  await resume(page);
  await expect(page.getByRole('heading', { name: 'Trial 1 of 120' })).toBeVisible();
});

test('keeps the participant device consistent when reopening a session', async ({ page }) => {
  await openSession(page);
  await page.getByRole('combobox', { name: 'Input device', exact: true }).click();
  await page.getByRole('option', { name: 'Touchpad', exact: true }).click();
  await page.getByRole('button', { name: 'Open session' }).click();
  await expect(page.getByRole('alert')).toContainText('Use the same mouse');
  expect((await downloadSession(page)).session.device).toBe('mouse');
});
