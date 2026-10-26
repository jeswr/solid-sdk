// AUTHORED-BY GPT-6.1-Sol (Codex)
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures';
import { completeOidcLogin, TEST_WEBID } from './helpers';

async function checkAccessibility(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual(
    [],
  );
}

test('add two local profiles, switch default across surfaces and manage them by keyboard', async ({
  context,
  extensionId,
}) => {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 400, height: 800 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);

  for (const [surface, webId, email, count] of [
    [popup, TEST_WEBID, 'test@example.com', 1],
    [panel, 'http://localhost:3000/work-pod/profile/card#me', 'work@example.com', 2],
  ] as const) {
    // Start both sign-ins through the shared profile UI, including the empty-store state.
    // Clearing only browser cookies avoids reusing the first account's CSS IdP session.
    await context.clearCookies();
    await surface.getByRole('button', { name: 'Add profile', exact: true }).focus();
    await surface.keyboard.press('Enter');
    const input = surface.getByRole('textbox', { name: 'Account ID', exact: true });
    await expect(input).toBeFocused();
    await checkAccessibility(surface);
    await input.fill(webId);
    const loginWindow = context.waitForEvent('page');
    await input.press('Enter');
    await completeOidcLogin(await loginWindow, email);
    await expect(surface.locator('#profile-list > li')).toHaveCount(count);
    await expect(surface.locator('#profile-status')).toHaveText('Profile added.');
  }

  const personal = popup.getByRole('button', { name: 'Set Alex Wilder as default', exact: true });
  const work = popup.getByRole('button', { name: 'Set Morgan Chen as default', exact: true });
  await expect(personal).toHaveAttribute('aria-pressed', 'true');
  await expect(work).toHaveAttribute('aria-pressed', 'false');
  await personal.focus();
  await popup.keyboard.press('ArrowDown');
  await expect(work).toBeFocused();
  await popup.keyboard.press('Space');
  await expect(work).toHaveAttribute('aria-pressed', 'true');
  await expect(
    panel.getByRole('button', { name: 'Set Morgan Chen as default', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('#account-menu')).toHaveAttribute('name', 'Morgan Chen');
  await popup.reload();
  await expect(
    popup.getByRole('button', { name: 'Set Morgan Chen as default', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(popup.locator('.profile-avatar img')).toHaveCount(2);
  await expect(panel.locator('.profile-avatar img')).toHaveCount(2);

  // Both surfaces, both themes, at their actual narrow widths.
  for (const [surface, name] of [
    [popup, 'popup'],
    [panel, 'sidepanel'],
  ] as const) {
    for (const theme of ['light', 'dark']) {
      await surface.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        theme === 'dark',
      );
      await checkAccessibility(surface);
      // Review artifacts, not pixel baselines: fonts and rasterisation differ between
      // runners, and committed baselines would fail on every environment but the author's.
      await test.info().attach(`profiles-${name}-${theme}.png`, {
        body: await surface.screenshot({ fullPage: true, animations: 'disabled' }),
        contentType: 'image/png',
      });
    }
    await surface.setViewportSize({ width: 320, height: 800 });
    expect(
      await surface.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(
      await surface.locator('#profiles button').evaluateAll((buttons) =>
        buttons
          .filter((button) => button.getClientRects().length > 0)
          .every((button) => {
            const box = button.getBoundingClientRect();
            return box.width >= 24 && box.height >= 24;
          }),
      ),
    ).toBe(true);
  }

  const rename = panel.getByRole('button', { name: 'Rename Morgan Chen', exact: true });
  await rename.focus();
  await panel.keyboard.press('Enter');
  await checkAccessibility(panel);
  await panel.getByRole('textbox', { name: 'Profile name' }).fill('Work');
  await panel.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: 'Rename Work', exact: true })).toBeFocused();
  await expect(
    popup.getByRole('button', { name: 'Set Work as default', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');

  // Escape cancels removal and returns to its trigger; confirmation then selects the survivor.
  await panel.getByRole('button', { name: 'Remove Work', exact: true }).focus();
  await panel.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused();
  await panel.keyboard.press('Escape');
  await expect(panel.getByRole('button', { name: 'Remove Work', exact: true })).toBeFocused();
  await panel.keyboard.press('Enter');
  await checkAccessibility(panel);
  await panel.keyboard.press('Shift+Tab');
  await panel.keyboard.press('Enter');
  await expect(panel.locator('#profile-list > li')).toHaveCount(1);
  await expect(
    panel.getByRole('button', { name: 'Set Alex Wilder as default', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByRole('button', { name: 'Add profile', exact: true })).toBeFocused();
});
