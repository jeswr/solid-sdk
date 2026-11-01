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

/** Review artifacts at every required width; axe also traverses the component shadow roots. */
async function captureMatrix(popup: Page, panel: Page, state: 'signed-out' | 'signed-in') {
  for (const [surface, name, widths] of [
    [popup, 'popup', [340]],
    [panel, 'sidepanel', [375, 768, 1280]],
  ] as const) {
    for (const width of widths) {
      await surface.setViewportSize({ width, height: 800 });
      for (const theme of ['light', 'dark']) {
        await surface.evaluate((mode) => {
          document.documentElement.classList.toggle('dark', mode === 'dark');
          document.documentElement.style.colorScheme = mode;
        }, theme);
        await expect(
          surface.locator('#signed-out:visible, #busy:visible, #signed-in:visible'),
        ).toHaveCount(1);
        await expect(surface.locator(`#${state}`)).toBeVisible();
        await expect(surface.locator('#profile-list > li')).toHaveCount(
          state === 'signed-in' ? 2 : 0,
        );
        expect(
          await surface.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        ).toBe(true);
        await test.info().attach(`accounts-${name}-${width}-${theme}-${state}.png`, {
          body: await surface.screenshot({ fullPage: true, animations: 'disabled' }),
          contentType: 'image/png',
        });
        await checkAccessibility(surface);
      }
    }
  }
  await popup.setViewportSize({ width: 340, height: 800 });
  await panel.setViewportSize({ width: 375, height: 800 });
}

test('add two local profiles, switch default across surfaces and manage them by keyboard', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  await context
    .serviceWorkers()[0]
    .evaluate(() => chrome.storage.local.set({ 'solid:show-pin-nudge': true }));
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 340, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 375, height: 800 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel/sidepanel.html`);
  await expect(popup.locator('#signed-out')).toBeVisible();
  await expect(panel.locator('#signed-out')).toBeVisible();
  await expect(popup.locator('#profiles-empty')).toBeVisible();
  await expect(panel.locator('#profiles-empty')).toBeVisible();
  await expect(popup.locator('#pin-nudge')).toBeVisible();
  await captureMatrix(popup, panel, 'signed-out');
  await popup.getByRole('button', { name: 'Got it', exact: true }).focus();
  await popup.keyboard.press('Enter');
  await expect(popup.locator('#pin-nudge')).toBeHidden();

  // Reduced motion must keep the skip link in the keyboard order and stop the spinner.
  await popup.emulateMedia({ reducedMotion: 'reduce' });
  await popup.reload();
  await expect(popup.locator('#signed-out')).toBeVisible();
  await popup.keyboard.press('Tab');
  await expect(popup.getByRole('link', { name: 'Skip to account', exact: true })).toBeFocused();
  await expect(popup.getByRole('link', { name: 'Skip to account', exact: true })).toBeInViewport();
  await expect(popup.locator('.spinner')).toHaveCSS('animation-name', 'none');
  await popup.emulateMedia({ reducedMotion: 'no-preference' });

  for (const [surface, webId, email, count] of [
    [popup, TEST_WEBID, 'test@example.com', 1],
    [panel, 'http://localhost:3000/work-pod/profile/card#me', 'work@example.com', 2],
  ] as const) {
    // Start both sign-ins through the shared profile UI, including the empty-store state.
    // Clearing only browser cookies avoids reusing the first account's CSS IdP session.
    await context.clearCookies();
    await surface.getByRole('button', { name: 'Add account', exact: true }).focus();
    await surface.keyboard.press('Enter');
    const input = surface.getByRole('textbox', { name: 'Account ID', exact: true });
    await expect(input).toBeFocused();
    await checkAccessibility(surface);
    await input.fill(webId);
    const loginWindow = context.waitForEvent('page');
    await input.press('Enter');
    await completeOidcLogin(await loginWindow, email);
    await expect(surface.locator('#profile-list > li')).toHaveCount(count);
    await expect(surface.locator('#profile-status')).toHaveText('Account added.');
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

  await expect(popup.locator('#account-name')).toHaveText('Morgan Chen');
  await expect(panel.locator('#account-host')).toHaveText('localhost:3000');
  await captureMatrix(popup, panel, 'signed-in');

  // The menu is styled through public parts; verify its destructive action and focus ring.
  const accountTrigger = popup.getByRole('button', { name: 'Account menu', exact: true });
  await accountTrigger.focus();
  await expect(accountTrigger).toHaveCSS('outline-width', '2px');
  await expect(accountTrigger).toHaveCSS('outline-offset', '2px');
  await popup.keyboard.press('Enter');
  await expect(popup.getByRole('menuitem', { name: 'Sign out', exact: true })).toBeVisible();
  await checkAccessibility(popup);
  await popup.keyboard.press('Escape');

  for (const surface of [popup, panel]) {
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
  await panel.getByRole('textbox', { name: 'Account name' }).fill('Work');
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
  await expect(panel.getByRole('button', { name: 'Add account', exact: true })).toBeFocused();
});
