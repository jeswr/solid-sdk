/**
 * Golden-path e2e (DESIGN.md P1): login → see My data, against a real local
 * Community Solid Server seeded by global-setup.ts (account `alice`).
 *
 * Login UX error states are tested first — they are the executable form of the
 * solid-reactive-authentication UX spec and fail loudest. The happy path drives
 * the full Solid-OIDC popup (CSS login → authorize) and asserts the
 * authenticated "My data" taxonomy renders.
 *
 * Patterns (test-infra skill): role/placeholder locators, auto-waits (no
 * sleep), and the buffered-popup helpers in e2e/helpers.ts.
 */
import { test, expect } from "@playwright/test";
import { bufferPages, completeCssLogin, revealSignInForm, waitForLoginPopup } from "./helpers";

// CSS port mirrors E2E_CSS_PORT (see playwright.config.ts / global-setup.ts).
const CSS_ORIGIN = `http://localhost:${process.env.E2E_CSS_PORT ?? "3099"}`;
const WEBID = `${CSS_ORIGIN}/alice/profile/card#me`; // seeded by global-setup
const EMAIL = "alice@example.com";
const PASSWORD = "test-password-123";

test.describe("Login surface", () => {
  test("shows the shared sign-in card with the home provider first", async ({ page }) => {
    await revealSignInForm(page);
    await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
    await expect(page.getByText("to continue to Pod Manager", { exact: true })).toBeVisible();
    const picker = page.getByRole("list", { name: "Providers", exact: true });
    // The button text includes the monogram; its accessible name is the provider name alone.
    await expect(picker.getByRole("button").first()).toHaveAccessibleName("Local provider");
    await expect(picker.getByRole("button", { name: "solidcommunity.net", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Get a pod", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "What is a WebID?", exact: true })).toBeVisible();
  });

  test("expands another provider inline", async ({ page }) => {
    await revealSignInForm(page);
    await page.getByRole("button", { name: "Other provider", exact: true }).click();
    // A URL input with a recent-providers datalist is a combobox, so select it by label.
    await expect(page.getByLabel("Provider address", { exact: true })).toBeEditable();
  });

  test("rejects a malformed pod address without navigating away", async ({ page }) => {
    await revealSignInForm(page);
    await page.getByRole("textbox", { name: "WebID", exact: true }).fill("not-a-valid-url");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("region", { name: "Sign in", exact: true }).getByRole("alert")).toContainText("That address isn't a WebID");
    await expect(page.getByRole("textbox", { name: "WebID", exact: true })).toBeVisible();
  });

  test("surfaces an unreachable / non-Solid address with a clear error", async ({ page }) => {
    await revealSignInForm(page);
    await page.getByRole("textbox", { name: "WebID", exact: true }).fill("https://nonexistent.invalid/profile/card#me");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    // Scope to the form's own error (Next injects its own role="alert" route announcer).
    await expect(page.getByRole("region", { name: "Sign in", exact: true }).getByRole("alert")).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Login with a bare issuer (no WebID)", () => {
  test("signs in with just the provider URL — the fresh-human path", async ({ page, context }) => {
    await revealSignInForm(page);

    // A brand-new user has no WebID to type: the provider's address alone
    // must work (the WebID comes back in the ID token's webid claim).
    await page.getByRole("textbox", { name: "WebID", exact: true }).fill(CSS_ORIGIN);

    const nextPage = bufferPages(context);
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    const popup = await waitForLoginPopup(nextPage);
    await completeCssLogin(popup, EMAIL, PASSWORD);

    // Landed authenticated on Home — identity learned from the token.
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe("Golden path: login → My data", () => {
  test("logs in through the OIDC popup and browses My data", async ({ page, context }) => {
    await revealSignInForm(page);

    // Confirm a private resource really is auth-gated, so a pass PROVES the auth
    // upgrade ran. The pod root is world-readable on a fresh CSS pod, but its
    // `.acl` (owner-only Control) is not — that is what login unlocks.
    const probe = await page.request.get(`${CSS_ORIGIN}/alice/.acl`, {
      failOnStatusCode: false,
    });
    expect(probe.status()).toBe(401);

    await page.getByRole("textbox", { name: "WebID", exact: true }).fill(WEBID);

    // Subscribe BEFORE clicking (see bufferPages docs in helpers.ts).
    const nextPage = bufferPages(context);
    await page.getByRole("button", { name: "Continue", exact: true }).click();

    const popup = await waitForLoginPopup(nextPage);
    await completeCssLogin(popup, EMAIL, PASSWORD);

    // Landed authenticated on Home.
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible({
      timeout: 30_000,
    });

    // Navigate to My data and see the two-tier taxonomy.
    await page.getByRole("link", { name: /^my data$/i }).first().click();
    await expect(page.getByRole("heading", { name: /^my data$/i })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/^common$/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /identity/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /health/i })).toBeVisible();
  });

  test("a reload restores the session via the refresh grant — NO popup/window opens", async ({
    page,
    context,
  }) => {
    // Sign in (persists a DPoP-bound refresh token + non-extractable key in
    // IndexedDB), then reload and assert the session comes back with zero
    // windows — the brief popup/tab a returning user used to see is gone,
    // because restore is now a token-endpoint fetch (refresh_token grant).
    await revealSignInForm(page);
    await page.getByRole("textbox", { name: "WebID", exact: true }).fill(WEBID);
    const firstLoginPages = bufferPages(context);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const popup = await waitForLoginPopup(firstLoginPages);
    await completeCssLogin(popup, EMAIL, PASSWORD);
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible({
      timeout: 30_000,
    });

    // Watch for ANY new page (popup/tab) from here on; a restore must open none.
    const openedAfterReload: string[] = [];
    context.on("page", (p) => openedAfterReload.push(p.url()));

    // A private read must also succeed silently (proves the restored session is
    // live, not just the public-profile shell).
    await page.reload();
    await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("link", { name: /^my data$/i }).first().click();
    await expect(page.getByRole("heading", { name: /^my data$/i })).toBeVisible({
      timeout: 15_000,
    });

    // The no-window proof: nothing opened across the whole restore.
    expect(openedAfterReload).toEqual([]);
  });
});
