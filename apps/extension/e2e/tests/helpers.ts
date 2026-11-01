import { type BrowserContext, expect, type Page } from '@playwright/test';

/** The seeded CSS test WebID (see e2e/setup/seed.json). */
export const TEST_WEBID = 'http://localhost:3000/test-pod/profile/card#me';
export const WORK_WEBID = 'http://localhost:3000/work-pod/profile/card#me';

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

/** Add an independently authenticated account through the shared profile controls. */
export async function addProfile(
  context: BrowserContext,
  surface: Page,
  webId: string,
  email: string,
): Promise<void> {
  const count = await surface.locator('#profile-list > li').count();
  // The IdP cookie must not silently select the account used by the previous login.
  // Extension credentials and grants remain intact in this test's fresh context.
  await context.clearCookies();
  await surface.getByRole('button', { name: 'Add account', exact: true }).click();
  const input = surface.getByRole('textbox', { name: 'Account ID', exact: true });
  await input.fill(webId);
  const loginWindow = context.waitForEvent('page');
  await input.press('Enter');
  await completeOidcLogin(await loginWindow, email);
  await expect(surface.locator('#profile-list > li')).toHaveCount(count + 1);
  await expect(surface.locator('#profile-status')).toHaveText('Account added.');
}

interface ConsentProfile {
  label: string;
  webId: string;
  targetUrl: string;
}

/** Drive the actual gesture-gated origin/class consent against the local CSS fixture. */
export async function grantOrigin(
  context: BrowserContext,
  page: Page,
  profile?: ConsentProfile,
): Promise<void> {
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
  await expect(consent.locator('#webid')).not.toBeEmpty();
  if (profile) {
    await consent.getByLabel('Change account').selectOption({ label: profile.label });
    // Selecting a different account resolves its own targets asynchronously. Wait for
    // both account and targets so approval cannot race the previous profile's view.
    await expect(consent.locator('#webid')).toHaveText(profile.label);
    await expect(consent.locator('.targets')).toHaveText(profile.targetUrl);
  } else {
    await expect(consent.locator('.targets')).toContainText('/private/notes');
  }
  await consent.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.locator('#grant-origin-fixture')).toHaveAttribute('data-approved', 'true');
}
