// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from '../fixtures';
import { performLogin } from './helpers';

const site = 'http://localhost:8080/address-form.html';

test('fills approved categories after preview and remembers consent separately from API access', async ({
  context,
  extensionId,
}) => {
  await performLogin(context, extensionId);
  const page = await context.newPage();
  await page.goto(site);
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('');
  // The closed shadow button is reached by clicking its visible host.
  const previewPromise = context.waitForEvent('page');
  await page.locator('[data-solid-formfill]').click();
  const preview = await previewPromise;
  await preview.waitForURL('**/formfill/preview.html?*');
  await expect(preview.getByLabel('Use profile')).toBeVisible();
  await expect(preview.locator('dd')).toContainText([
    'Alex Wilder',
    'test@example.com',
    '42 Sample Street',
    'Oxford',
    'OX1 1AA',
    'United Kingdom',
  ]);
  await preview.getByLabel('Contact details', { exact: true }).check();
  await preview.getByLabel('Address', { exact: true }).check();
  await preview.getByLabel('Remember for this site').check();
  // Exercise native keyboard submission.
  await preview.getByRole('button', { name: 'Fill', exact: true }).focus();
  // Fill closes the preview window, which can end the key press before Playwright returns.
  const closed = preview.waitForEvent('close');
  await preview.keyboard.press('Enter').catch((error: Error) => {
    if (!/closed/.test(error.message)) throw error;
  });
  await closed;
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Alex Wilder');
  await expect(page.getByLabel('Street address')).toHaveValue('42 Sample Street');
  await expect(page.getByLabel('Country')).toHaveValue('GB');
  for (const id of ['secret', 'payment', 'code', 'off'])
    await expect(page.locator(`#${id}`)).toHaveValue('');
  expect(page.url()).toBe(site);
  expect(await page.evaluate(() => 'fetch' in (window as unknown as { solid: object }).solid)).toBe(
    false,
  );
  await page.reload();
  const againPromise = context.waitForEvent('page');
  await page.locator('[data-solid-formfill]').click();
  const again = await againPromise;
  await expect(again.getByLabel('Contact details', { exact: true })).toBeChecked();
  await expect(again.getByLabel('Address', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('');
  await again.getByRole('button', { name: 'Cancel' }).click();
});

test('cancel leaves every field untouched', async ({ context, extensionId }) => {
  await performLogin(context, extensionId);
  const page = await context.newPage();
  await page.goto(site);
  const previewPromise = context.waitForEvent('page');
  await page.locator('[data-solid-formfill]').click();
  const preview = await previewPromise;
  await preview.waitForURL('**/formfill/preview.html?*');
  await preview.getByRole('button', { name: 'Cancel' }).click();
  for (const input of await page.locator('input').all()) await expect(input).toHaveValue('');
});

test('cross-origin iframe refuses icons and a worker-routed trigger', async ({
  context,
  extensionId,
}) => {
  await performLogin(context, extensionId);
  const page = await context.newPage();
  await page.goto('http://localhost:8080/');
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.src = 'http://127.0.0.1:8080/address-form.html';
    document.body.append(frame);
  });
  const frame = page.frameLocator('iframe');
  await expect(frame.getByLabel('Full name', { exact: true })).toBeVisible();
  await expect(frame.locator('[data-solid-formfill]')).toHaveCount(0);
  await frame.getByLabel('Full name', { exact: true }).focus();
  // Browser context menus are outside Playwright's page surface; exercise the worker delivery seam.
  await context.serviceWorkers()[0].evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'http://localhost:8080/*' });
    for (const tab of tabs)
      if (tab.id !== undefined)
        await chrome.tabs.sendMessage(tab.id, { type: 'SOLID_FORMFILL_TRIGGER' }).catch(() => {});
  });
  await expect(frame.getByLabel('Full name', { exact: true })).toHaveValue('');
  expect(context.pages().some((p) => p.url().includes('/formfill/preview.html'))).toBe(false);
});
