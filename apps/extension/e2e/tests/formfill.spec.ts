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
  await expect(preview.getByLabel('Use account')).toBeVisible();
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

for (const navigation of ['history', 'hash'] as const) {
  test(`${navigation} changes keep the document and allow its reviewed fill`, async ({
    context,
    extensionId,
  }) => {
    await performLogin(context, extensionId);
    const page = await context.newPage();
    await page.goto(site);
    await page.locator('form').evaluate((form) => form.setAttribute('data-original-document', ''));
    const previewPromise = context.waitForEvent('page');
    await page.locator('[data-solid-formfill]').click();
    const preview = await previewPromise;
    await expect(preview.locator('dd')).toContainText(['Alex Wilder', 'test@example.com']);
    await preview.getByLabel('Contact details', { exact: true }).check();
    await preview.getByLabel('Address', { exact: true }).check();

    const destination =
      navigation === 'history' ? 'http://localhost:8080/checkout?step=2' : `${site}#address`;
    await page.evaluate(
      ({ navigation, destination }) => {
        if (navigation === 'history') history.pushState({ step: 2 }, '', destination);
        else location.hash = new URL(destination).hash;
      },
      { navigation, destination },
    );
    await page.waitForURL(destination);
    await expect(page.locator('form[data-original-document]')).toHaveCount(1);
    await Promise.all([
      preview.waitForEvent('close'),
      preview.getByRole('button', { name: 'Fill', exact: true }).click(),
    ]);
    await expect(page.getByLabel('Full name', { exact: true })).toHaveValue('Alex Wilder');
    await expect(page.getByLabel('Street address')).toHaveValue('42 Sample Street');
    expect(page.url()).toBe(destination);
  });
}

for (const navigation of ['navigation', 'reload'] as const) {
  test(`same-origin ${navigation} gives the replacement document no values from the old review`, async ({
    context,
    extensionId,
  }) => {
    await performLogin(context, extensionId);
    const page = await context.newPage();
    await page.goto(site);
    await page.locator('form').evaluate((form) => form.setAttribute('data-original-document', ''));
    const previewPromise = context.waitForEvent('page');
    await page.locator('[data-solid-formfill]').click();
    const preview = await previewPromise;
    await expect(preview.locator('dd')).toContainText(['Alex Wilder', 'test@example.com']);
    const requestId = new URL(preview.url()).searchParams.get('requestId')!;
    await preview.getByLabel('Contact details', { exact: true }).check();
    await preview.getByLabel('Address', { exact: true }).check();

    const response =
      navigation === 'reload' ? await page.reload() : await page.goto(`${site}?replacement=1`);
    expect(response?.status()).toBe(200);
    await expect(page.locator('form[data-original-document]')).toHaveCount(0);
    await expect(page.locator('[data-solid-formfill]')).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.dataset.formFillEvents = '0';
      for (const type of ['input', 'change'])
        document.addEventListener(type, () => {
          const root = document.documentElement;
          root.dataset.formFillEvents = String(Number(root.dataset.formFillEvents) + 1);
        });
    });

    // Use an actual trusted extension document to observe completion of the old request.
    // The preview can close itself before the worker has finished releasing its response.
    const observer = await context.newPage();
    await observer.goto(`chrome-extension://${extensionId}/formfill/preview.html`);
    await expect(observer.locator('#error')).toHaveText('This fill request is unavailable.');
    await Promise.all([
      preview.waitForEvent('close'),
      preview.getByRole('button', { name: 'Fill', exact: true }).click(),
    ]);
    await expect
      .poll(() =>
        observer.evaluate(
          (requestId) => chrome.runtime.sendMessage({ type: 'SOLID_FORMFILL_PREVIEW', requestId }),
          requestId,
        ),
      )
      .toBeNull();
    for (const field of await page.locator('input, select').all())
      await expect(field).toHaveValue('');
    await expect(page.locator('html')).toHaveAttribute('data-form-fill-events', '0');

    // The replacement controller is live, but must start a separate review to receive values.
    const freshPromise = context.waitForEvent('page');
    await page.locator('[data-solid-formfill]').click();
    const fresh = await freshPromise;
    await expect(fresh.getByLabel('Contact details', { exact: true })).not.toBeChecked();
    expect(new URL(fresh.url()).searchParams.get('requestId')).not.toBe(requestId);
    await fresh.getByRole('button', { name: 'Cancel' }).click();
  });
}

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
