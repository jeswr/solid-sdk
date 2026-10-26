import { type BrowserContext, expect, type Page } from '@playwright/test';

/** The seeded CSS test WebID (see e2e/setup/seed.json). */
export const TEST_WEBID = 'http://localhost:3000/test-pod/profile/card#me';

/**
 * Complete the CSS OIDC login + consent flow on the window
 * `chrome.identity.launchWebAuthFlow` opened. CSS auto-redirects to the password page,
 * then to consent; both have JS-enabled submit buttons we wait on.
 */
export async function completeOidcLogin(
  loginPage: Page,
  email = 'test@example.com',
): Promise<void> {
  await loginPage.waitForLoadState('networkidle');
  await loginPage.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 10_000 });
  await loginPage.fill('#email', email);
  await loginPage.fill('#password', 'test-password-123');
  await loginPage.click('button[type="submit"]');

  await loginPage.waitForURL('**/.account/oidc/consent/**', { timeout: 10_000 });
  await loginPage.waitForLoadState('networkidle');
  await loginPage.waitForSelector('#authorize:not([disabled])', { timeout: 10_000 });
  await loginPage.click('#authorize');
}

/**
 * Drive a full login through the extension popup. Opens the popup, enters the WebID,
 * completes the CSS OIDC flow in the launched window, then reopens the popup and waits
 * for the signed-in state (the <jeswr-account-menu> appears in #signed-in).
 */
export async function performLogin(
  context: BrowserContext,
  extensionId: string,
  webId: string = TEST_WEBID,
): Promise<void> {
  const popupPage = await context.newPage();
  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  // The signed-out surface is now <jeswr-login-panel>; drive its shadow parts.
  // Playwright's CSS engine pierces the (open) shadow root, so `part=` selectors work.
  await popupPage.getByLabel('Your WebID').fill(webId);

  const loginPagePromise = context.waitForEvent('page');
  await popupPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await completeOidcLogin(await loginPagePromise);

  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popupPage.locator('#signed-in').waitFor({ state: 'visible', timeout: 15_000 });
  await popupPage.close();
}

/** Drive the actual gesture-gated origin/class consent against the local CSS fixture. */
export async function grantOrigin(context: BrowserContext, page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      typeof (window as unknown as { solid?: { requestAccess?: unknown } }).solid?.requestAccess ===
      'function',
  );
  await page.evaluate(() => {
    const button = document.createElement('button');
    button.id = 'grant-origin-fixture';
    button.textContent = 'Grant origin access';
    button.addEventListener('click', () => {
      const solid = (
        window as unknown as {
          solid: { requestAccess(request: unknown): Promise<{ ok: boolean }> };
        }
      ).solid;
      void solid
        .requestAccess({
          classes: ['https://schema.org/TextDigitalDocument'],
          modes: ['read'],
          duration: 'P1D',
        })
        .then((result) => {
          button.dataset.approved = String(result.ok);
        });
    });
    document.body.appendChild(button);
  });
  const consentPromise = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Grant origin access' }).click();
  const consent = await consentPromise;
  await consent.waitForURL('**/consent/consent.html?*');
  await expect(consent.getByLabel('Share from profile')).toBeVisible();
  await expect(consent.locator('.targets')).toContainText('/private/notes');
  await consent.getByRole('button', { name: 'Approve selected' }).click();
  await expect(page.locator('#grant-origin-fixture')).toHaveAttribute('data-approved', 'true');
}
