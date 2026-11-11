// AUTHORED-BY Claude Opus 5.5
//
// LIVE: a real person's sign-in through Drive's deployed build against the suite's own test
// identity provider (idp.solid-test.jeswr.org, a prod-solid-server broker in front of Keycloak).
//
//   1. New account: Drive → provider button → Keycloak registration → handle form →
//      "Your account is ready" → Continue → consent → Drive shows "Your files".
//   2. Existing account: a fresh browser signs in with the same account's username and password.
//
// The account is a throwaway with random credentials that are never logged or stored; the
// maintainer approved creating these on the test IdP only. Never point this at a public provider.
import { randomBytes } from "node:crypto";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";

const APP_URL = process.env.LIVE_APP_URL ?? "https://jeswr.github.io/solid-sdk/pod-drive/";
const PROVIDER = process.env.LIVE_PROVIDER_NAME ?? "idp.solid-test.jeswr.org";
const ISSUER_HOST = new URL(process.env.LIVE_ISSUER ?? "https://idp.solid-test.jeswr.org").host;

if (!/(^|\.)solid-test\.jeswr\.org$/.test(ISSUER_HOST)) {
  throw new Error("The live sign-up suite only runs against the suite's own test IdP.");
}

/** Pod-auth's sign-in card lives in shadow DOM; open shadow roots so role queries reach it. */
async function openShadowRoots(context: BrowserContext) {
  await context.addInitScript(() => {
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (init: ShadowRootInit) {
      return attach.call(this, { ...init, mode: "open" });
    };
  });
}

/** Choose the provider on Drive's sign-in screen and return the identity provider's popup. */
async function startSignIn(page: Page): Promise<Page> {
  await page.goto(APP_URL);
  const another = page.getByRole("button", { name: "Use another account" });
  if (await another.isVisible({ timeout: 8_000 }).catch(() => false)) await another.click();
  const popupPromise = page.context().waitForEvent("page", { timeout: 45_000 });
  await page.getByRole("button", { name: PROVIDER }).first().click();
  // Some builds confirm in an <authorization-code-flow> dialog before opening the popup.
  const open = page.locator("authorization-code-flow button[value=open]").first();
  if (await open.isVisible({ timeout: 5_000 }).catch(() => false)) await open.click();
  const popup = await popupPromise;
  await popup.waitForURL((url) => url.host === ISSUER_HOST, { timeout: 30_000 });
  return popup;
}

/** Accept the app's consent prompt if the provider shows one; resolves when the popup closes. */
async function finishInPopup(popup: Page) {
  const allow = popup.getByRole("button", { name: "Allow" });
  const outcome = await Promise.race([
    allow.waitFor({ timeout: 45_000 }).then(() => "consent" as const),
    popup.waitForEvent("close", { timeout: 45_000 }).then(() => "closed" as const),
  ]);
  if (outcome === "consent") {
    await allow.click();
    await popup.waitForEvent("close", { timeout: 30_000 }).catch(() => undefined);
  }
}

async function expectSignedIn(page: Page) {
  await expect(page.getByRole("heading", { name: "Your files" })).toBeVisible({ timeout: 45_000 });
  await expect(page.getByRole("alert").filter({ hasText: /\S/ })).toHaveCount(0);
}

test("test IdP: sign up through Drive, then sign in again with the same account", async ({
  browser,
}) => {
  const suffix = randomBytes(5).toString("hex");
  const account = {
    username: `signin-live-${suffix}`,
    password: `${randomBytes(18).toString("base64url")}aA1!`,
    handle: `live${suffix}`,
  };

  await test.step("new account: sign-up returns to Drive signed in", async () => {
    const context = await browser.newContext();
    await openShadowRoots(context);
    const page = await context.newPage();
    const popup = await startSignIn(page);

    await popup.getByRole("link", { name: "Register" }).click();
    await popup.locator("#username").fill(account.username);
    await popup.locator("#password").fill(account.password);
    await popup.locator("#password-confirm").fill(account.password);
    await popup.locator("#email").fill(`${account.username}@example.com`);
    await popup.locator("#firstName").fill("Sign-in");
    await popup.locator("#lastName").fill("Live test");
    await popup.locator("input[type=submit]").click();

    await expect(popup.getByRole("heading", { name: "Create your Solid account" })).toBeVisible();
    await popup.getByLabel("Choose your handle").fill(account.handle);
    await popup.getByRole("button", { name: "Create my account" }).click();
    await expect(popup.getByRole("heading", { name: "Your account is ready" })).toBeVisible();

    // Continue must resume the app's sign-in (a form button), not leave it for another site.
    // Soft, so the existing-account step below still runs and reports on its own.
    const resume = popup.getByRole("button", { name: "Continue" });
    const resumable = (await resume.count()) === 1;
    expect
      .soft(
        resumable,
        "'Your account is ready' has no resume button: Continue leaves the sign-in, so the app " +
          "never hears back (fixed by prod-solid-server#202; needs a solid-test redeploy)",
      )
      .toBe(true);
    if (resumable) {
      await resume.click();
      await finishInPopup(popup);
      await expectSignedIn(page);
    }
    await context.close();
  });

  await test.step("existing account: a fresh browser signs in with username and password", async () => {
    const context = await browser.newContext();
    await openShadowRoots(context);
    const page = await context.newPage();
    const popup = await startSignIn(page);
    await popup.locator("#username").fill(account.username);
    await popup.locator("#password").fill(account.password);
    await popup.locator("#kc-login").click();
    await finishInPopup(popup);
    await expectSignedIn(page);
    await context.close();
  });
});
