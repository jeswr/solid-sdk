// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from '../fixtures';
import { grantOrigin, performLogin } from './helpers';
import {
  checkPermissionAccessibility,
  permissionViewports,
  setPermissionViewport,
} from './permission-a11y';

test('populated grant rows reflow and meet browser axe checks in both themes', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await performLogin(context, extensionId);
  const site = await context.newPage();
  await site.goto('http://localhost:8080');
  await grantOrigin(context, site);
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
  const manager = panel.getByRole('region', { name: 'Sites with access' });
  const row = manager.getByRole('article', { name: 'http://localhost:8080' });
  await expect(row).toBeVisible();
  await expect(row.locator('.grants-bound-account')).toContainText('Alex Wilder');
  await expect(row.locator('.grants-summary')).toContainText('Documents');
  const containers =
    '#grants .permission-row, #grants .grants-summary, #grants .grants-details, ' +
    '#grants .grants-class, #grants button, #grants select';
  const details = row.getByRole('button', { name: 'Access details' });

  for (const { width, theme } of permissionViewports) {
    await test.step(`${width}px ${theme}`, async () => {
      await setPermissionViewport(panel, width, theme);
      await expect(details).toHaveAttribute('aria-expanded', 'false');
      await checkPermissionAccessibility(panel, '#grants', containers, `grants-${width}-${theme}`);

      await details.click();
      await expect(details).toHaveAttribute('aria-expanded', 'true');
      await expect(row.getByRole('list', { name: 'Data access' })).toContainText('Documents');
      await expect(row.getByLabel('Account', { exact: true })).toBeVisible();
      await checkPermissionAccessibility(
        panel,
        '#grants',
        containers,
        `grant-details-${width}-${theme}`,
      );

      await row.getByRole('button', { name: 'Revoke', exact: true }).click();
      const dialog = panel.getByRole('dialog', { name: 'Revoke site access?' });
      await expect(dialog).toBeVisible();
      await checkPermissionAccessibility(
        panel,
        'dialog[open]',
        'dialog[open], dialog[open] button',
        `grant-confirmation-${width}-${theme}`,
      );
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(dialog).toBeHidden();
      await details.click();
    });
  }
});

test('populated form-fill preview cards reflow and meet browser axe checks in both themes', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await performLogin(context, extensionId);
  const site = await context.newPage();
  await site.goto('http://localhost:8080/address-form.html');
  const opened = context.waitForEvent('page');
  await site.locator('[data-solid-formfill]').click();
  const preview = await opened;
  await preview.waitForURL('**/formfill/preview.html?*');
  await expect(preview.locator('.category-card')).toHaveCount(2);
  await expect(preview.locator('dd')).toHaveText([
    'Alex Wilder',
    'test@example.com',
    '42 Sample Street',
    'Oxford',
    'OX1 1AA',
    'United Kingdom',
  ]);
  const contact = preview.getByLabel('Contact details', { exact: true });
  const address = preview.getByLabel('Address', { exact: true });
  const remember = preview.getByLabel('Remember for this site', { exact: true });
  const fill = preview.getByRole('button', { name: 'Fill', exact: true });
  const containers = '.category-card, .category-card dd, .actions, button, select';

  for (const { width, theme } of permissionViewports) {
    await test.step(`${width}px ${theme}`, async () => {
      await setPermissionViewport(preview, width, theme);
      await expect(fill).toBeDisabled();
      await checkPermissionAccessibility(
        preview,
        '#content',
        containers,
        `preview-unchecked-${width}-${theme}`,
      );

      await contact.check();
      await address.check();
      await remember.check();
      await expect(fill).toBeEnabled();
      await checkPermissionAccessibility(
        preview,
        '#content',
        containers,
        `preview-checked-${width}-${theme}`,
      );
      await contact.uncheck();
      await address.uncheck();
      await remember.uncheck();
    });
  }
  await preview.getByRole('button', { name: 'Cancel', exact: true }).click();
  for (const input of await site.locator('input').all()) await expect(input).toHaveValue('');
});
