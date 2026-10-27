// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from '../fixtures';
import { grantOrigin, performLogin } from './helpers';

test('revoking site access from the side panel denies the next captured window.solid fetch', async ({
  context,
  extensionId,
}) => {
  await performLogin(context, extensionId);
  const site = await context.newPage();
  await site.goto('http://localhost:8080');
  await grantOrigin(context, site);
  await expect(site.locator('#fetch-result')).toContainText('Private Note');
  // Keep the page's existing API reference: broadcasts remove fetch from the public
  // stub after revocation, but the worker must also deny previously captured calls.
  await site.evaluate(() => {
    const page = window as unknown as {
      solid: { fetch: (url: string) => Promise<Response> };
      capturedSolidFetch: (url: string) => Promise<Response>;
    };
    page.capturedSolidFetch = page.solid.fetch;
  });

  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
  const manager = panel.getByRole('region', { name: 'Sites with access' });
  const row = manager.getByRole('article', { name: 'http://localhost:8080' });
  await expect(row).toBeVisible();
  const details = row.getByRole('button', { name: 'Access details' });
  await details.focus();
  await panel.keyboard.press('Space');
  await expect(details).toHaveAttribute('aria-expanded', 'true');
  await expect(row.getByRole('list', { name: 'Data access' })).toContainText('Documents');

  const revoke = row.getByRole('button', { name: 'Revoke', exact: true });
  await revoke.focus();
  await panel.keyboard.press('Enter');
  const dialog = panel.getByRole('dialog', { name: 'Revoke site access?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await panel.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Revoke access' })).toBeFocused();
  await panel.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused();
  await panel.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(revoke).toBeFocused();
  await panel.keyboard.press('Enter');
  await expect(dialog).toBeVisible();
  await panel.keyboard.press('Tab');
  await panel.keyboard.press('Space');
  await expect(manager.getByRole('status')).toContainText('Access revoked');
  await expect(manager.getByText('No sites have access yet', { exact: true })).toBeVisible();

  const denied = await site.evaluate(async () => {
    try {
      await (
        window as unknown as { capturedSolidFetch: (url: string) => Promise<Response> }
      ).capturedSolidFetch('http://localhost:3000/test-pod/private/notes');
      return 'unexpected success';
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(denied).toMatch(/not granted/i);
  await expect
    .poll(() =>
      site.evaluate(() => Object.keys((window as unknown as { solid: object }).solid).sort()),
    )
    .toEqual(['login', 'requestAccess']);
});
