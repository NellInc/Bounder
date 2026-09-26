import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Multi-interaction scene captures and full-page axe checks, matching the existing 90s browser journeys.
test.setTimeout(90_000);

test('scene and consequence lead; camera and text views preserve the recorded decision', async ({ page }) => {
  await page.setViewportSize({ width: 1488, height: 1058 });
  await page.goto('/simulator.html?scenario=civilian');
  const stage = page.locator('.simulator-stage');
  await expect(stage).toHaveAttribute('data-webgl', 'ready');
  await expect(page.locator('.decision-outcome')).toHaveText('Request denied');
  await expect(page.locator('.adapter-output')).toHaveText('Hold outside civilian buffer');
  await expect(page.locator('#fleet-evidence')).not.toHaveAttribute('open', '');
  await page.screenshot({ path: 'artifacts/verification/workspace-desktop.png', fullPage: false });
  const before = await page.locator('.decision-code').textContent();
  const sceneBox = await stage.boundingBox();
  const resultBox = await page.locator('.decision-panel').boundingBox();
  expect(resultBox.x).toBeGreaterThan(sceneBox.x + sceneBox.width);
  expect(Math.abs(resultBox.y - sceneBox.y)).toBeLessThan(2);
  for (const [name, view] of [['Top-down', 'top'], ['Focus on drone', 'focus'], ['Overview', 'overview']]) {
    await page.getByRole('button', { name, exact: true }).click();
    await expect(stage).toHaveAttribute('data-camera-view', view);
    await expect(page.locator('.decision-code')).toHaveText(before);
  }
  await page.getByLabel('Scene detail').selectOption('low');
  await expect(stage).toHaveAttribute('data-render-quality', 'low');
  const textView = page.getByRole('button', { name: 'Text view', exact: true });
  await textView.click();
  await expect(textView).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.scene-explanation')).toContainText('Hold outside civilian buffer');
  await expect(stage).toHaveAttribute('data-animation-state', 'offscreen');
  await textView.click();
  await expect(textView).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.scene-explanation')).toBeHidden();
  await expect(stage).toHaveAttribute('data-animation-state', 'idle');
  await expect(page.locator('.decision-code')).toHaveText(before);
  const idleFrames = await stage.getAttribute('data-render-frames');
  await page.waitForTimeout(250);
  await expect(stage).toHaveAttribute('data-render-frames', idleFrames);
  await page.locator('.site-footer').scrollIntoViewIfNeeded();
  await expect(stage).toHaveAttribute('data-animation-state', 'offscreen');
  await page.getByRole('button', { name: 'Top-down', exact: true }).focus();
  await stage.locator('canvas').dispatchEvent('webglcontextlost');
  await expect(stage).toHaveAttribute('data-webgl', 'context-lost');
  await expect(page.locator('.receipt-details > summary')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Top-down', exact: true })).toBeDisabled();
});

test('Fleet inspector filters real records and exposes complete reasons without hover', async ({ page }) => {
  await page.goto('/simulator.html');
  await expect(page.locator('.simulator-stage')).toHaveAttribute('data-fleet-ready', 'true', { timeout: 20_000 });
  await page.getByRole('link', { name: 'Fleet evidence', exact: true }).click();
  await expect(page.locator('[data-fleet-count]')).toHaveText('100 of 100 recorded Guardians');
  await page.getByLabel('Platform', { exact: true }).selectOption('marine');
  await page.getByLabel('Outcome', { exact: true }).selectOption('held');
  const rows = page.locator('.fleet-node:visible');
  expect(await rows.count()).toBeGreaterThan(0);
  for (const row of await rows.all()) {
    await expect(row).toHaveAttribute('data-platform', 'marine');
    await expect(row).toHaveAttribute('data-outcome', 'held');
  }
  await page.getByLabel('Find a Guardian').fill('bounder-marine-003');
  await expect(rows).toHaveCount(1);
  await rows.locator('summary').click();
  await expect(rows.locator('pre')).toContainText('bounder-marine-003');
  await expect(rows.locator('.fleet-device-reason')).toBeVisible();
  await page.locator('#fleet-evidence').screenshot({ path: 'artifacts/verification/fleet-detail.png' });
  await page.getByLabel('Find a Guardian').fill('no-matching-guardian');
  await expect(rows).toHaveCount(0);
  await expect(page.locator('[data-fleet-count]')).toContainText('No matching results');
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await expect(page.locator('[data-fleet-count]')).toHaveText('100 of 100 recorded Guardians');
  await expect(page.getByLabel('Find a Guardian')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Clear filters', exact: true })).toBeDisabled();
});

test('mobile workspace and expanded evidence stay accessible and within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/simulator.html?scenario=civilian');
  await expect(page.locator('.simulator-stage')).toHaveAttribute('data-webgl', 'ready');
  const sceneBox = await page.locator('.scene-column').boundingBox();
  const resultBox = await page.locator('.decision-panel').boundingBox();
  expect(resultBox.y).toBeGreaterThanOrEqual(sceneBox.y + sceneBox.height);
  await page.screenshot({ path: 'artifacts/verification/workspace-mobile.png', fullPage: true });
  for (const id of ['fleet-evidence', 'contract-inspector', 'fault-replay']) {
    await page.locator(`#${id} > summary`).click();
  }
  await page.locator('.receipt-details > summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test('failed vector transport retains local inspection and can retry without broadening authority', async ({ page }) => {
  await page.route('**/data/creedspace-bounder-golden-v1.json', (route) => route.abort('timedout'));
  await page.goto('/simulator.html?webgl=off#contract-inspector');
  await page.getByRole('button', { name: 'Verify published example' }).click();
  await expect(page.locator('[data-policy-status]')).toContainText('retry the published example');
  await expect(page.locator('[data-policy-file]')).toBeEnabled();
  await expect(page.locator('[data-policy-status]')).toHaveAttribute('data-state', 'rejected');
  await page.unroute('**/data/creedspace-bounder-golden-v1.json');
  await page.getByRole('button', { name: 'Verify published example' }).click();
  await expect(page.locator('[data-policy-status]')).toHaveAttribute('data-state', 'held');
  await expect(page.locator('[data-policy-step="signature"]')).toHaveAttribute('data-state', 'verified');
});

test('contact retains failed submissions and requires provider acceptance for success', async ({ page }) => {
  let accepted = false;
  let requests = 0;
  await page.route('https://formspree.io/f/xqalyykn', (route) => {
    requests += 1;
    return route.fulfill({ status: accepted ? 200 : 503, contentType: 'application/json', body: JSON.stringify(accepted ? { next: 'https://formspree.io/thanks' } : { errors: [{ message: 'Unavailable' }] }) });
  });
  await page.goto('/contact.html?success=true');
  await expect(page.locator('#form-success')).toBeHidden();
  await expect(page.locator('[data-hosted-submit]')).toBeHidden();
  await page.getByLabel('Name', { exact: false }).fill('Local browser test');
  await page.getByLabel('Email address', { exact: false }).fill('test@example.invalid');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Test message intercepted by the browser test.');
  await page.locator('#privacy_consent').check();
  await page.getByRole('button', { name: 'Send enquiry', exact: false }).click();
  await expect(page.locator('#form-error')).toBeVisible();
  await expect(page.locator('#form-error')).toBeFocused();
  await expect(page.locator('#message')).toHaveValue('Test message intercepted by the browser test.');
  // The idle label, including its decorative arrow, is restored after a failed send.
  const primarySubmit = page.locator('#contact-form button[type="submit"]:not([data-hosted-submit])');
  await expect(primarySubmit.locator('[data-label]')).toHaveText('Send enquiry');
  await expect(primarySubmit.locator('span[aria-hidden="true"]')).toHaveText('→');
  accepted = true;
  await page.getByRole('button', { name: 'Send enquiry', exact: false }).click();
  await expect(page.locator('#form-success')).toBeVisible();
  await expect(page.locator('#contact-form')).toBeHidden();
  await expect(page.locator('#contact-form-title')).toBeHidden();
  await expect(page.locator('.form-required-note')).toBeHidden();
  expect(requests).toBe(2);
});
