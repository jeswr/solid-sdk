import type { BrowserContext, Page } from '@playwright/test';
import { expect } from '../fixtures';

/** The seeded CSS test WebID (see e2e/setup/seed.json). */
export const TEST_WEBID = 'http://localhost:3000/test-pod/profile/card#me';

/**
 * Opt a test app into the popup's session through the real, origin-verified content
 * script path. Popup login alone deliberately grants no unrelated website access.
 * Await the worker's acknowledgement before loading the app again for its state read.
 */
export async function grantTestSite(context: BrowserContext, page: Page): Promise<void> {
  const origin = new URL(page.url()).origin;
  const result = await context.serviceWorkers()[0].evaluate(async (appOrigin) => {
    const tabs = await chrome.tabs.query({ url: `${appOrigin}/*` });
    const tabId = tabs[0]?.id;
    if (tabId === undefined) throw new Error('Test app tab not found');
    const [reply] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'ISOLATED',
      func: () =>
        chrome.runtime.sendMessage({
          type: 'SOLID_SET_CLIENT_ID',
          origin: location.origin,
          clientId: `${location.origin}/client-id`,
        }),
    });
    return reply.result;
  }, origin);
  expect(result).toEqual({ ok: true });
  await page.reload();
}

/**
 * Complete the CSS OIDC login + consent flow on the window
 * `chrome.identity.launchWebAuthFlow` opened. CSS auto-redirects to the password page,
 * then to consent; both have JS-enabled submit buttons we wait on.
 */
export async function completeOidcLogin(loginPage: Page): Promise<void> {
  await loginPage.waitForLoadState('networkidle');
  await loginPage.waitForSelector('button[type="submit"]:not([disabled])', { timeout: 10_000 });
  await loginPage.fill('#email', 'test@example.com');
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
  // CSS descendants pierce the open shadow root and reach controls nested in the form.
  // `>>>` is parsed as `>>` then `>` and incorrectly requires a direct child.
  await popupPage.fill('#login-panel [part="webid-input"]', webId);

  const loginPagePromise = context.waitForEvent('page');
  await popupPage.click('#login-panel [part="login-button"]');
  await completeOidcLogin(await loginPagePromise);

  await popupPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await popupPage.locator('#signed-in').waitFor({ state: 'visible', timeout: 15_000 });
  await popupPage.close();
}
