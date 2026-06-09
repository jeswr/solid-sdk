/**
 * Golden-path e2e against a real local Community Solid Server. playwright.config.ts
 * starts CSS and the app; each write test gets a FRESH account (createCssAccount)
 * so the pod starts empty and tests don't interfere — isolation without restarting
 * CSS (skill: solid-test-infrastructure). Login uses the popup driven by
 * <authorization-code-flow>; we fill the CSS login form inside the popup.
 */
import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { createCssAccount, type CssAccount } from "./css-account";

const CSS_BASE = process.env.IT_CSS_BASE ?? "http://localhost:3000";

/**
 * Drive the CSS login (and consent, if shown) inside the interactive popup. The
 * interactive popup lands on /.account/ then client-redirects to the password
 * form, so we wait for #email rather than probing once. The transient prompt=none
 * popup has no form and closes itself — the try/catch swallows it.
 */
function handleLoginPopups(context: BrowserContext, email: string, password: string): void {
  const seen = (locator: ReturnType<Page["locator"]>, timeout: number) =>
    locator.waitFor({ state: "visible", timeout }).then(() => true, () => false);

  context.on("page", async (popup: Page) => {
    try {
      // Login form — present on first login, absent after reload (the CSS session
      // cookie survives, so it goes straight to consent).
      const field = popup.locator("#email");
      if (await seen(field, 10_000)) {
        await field.fill(email);
        await popup.locator("#password").fill(password);
        await popup.getByRole("button", { name: /^log in$/i }).click();
      }
      // Consent/authorize screen — a new dynamic client needs consent every time.
      const consent = popup.getByRole("button", { name: /authorize|consent|allow|continue/i });
      if (await seen(consent, 10_000)) await consent.click();
    } catch {
      /* transient prompt=none popup: no form, closes itself */
    }
  });
}

test.describe("Login surface", () => {
  test("offers WebID-first entry with a get-a-pod link", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByLabel(/your webid/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /get .*pod/i })).toBeVisible();
  });

  test("rejects a malformed WebID without navigating", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel(/your webid/i).fill("not-a-url");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByText(/look like a url|must be an http/i)).toBeVisible();
  });

  test("surfaces an unreachable profile as an error", async ({ page }) => {
    await page.goto("/");
    // Connection-refused host: fails fast and deterministically.
    await page.getByLabel(/your webid/i).fill("http://localhost:9999/profile/card#me");
    await page.getByRole("button", { name: /sign in/i }).click();
    // Scope to the populated alert (Next renders an empty route-announcer with role=alert).
    await expect(page.locator('[role="alert"]').filter({ hasText: /\S/ })).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Issues (authenticated)", () => {
  let account: CssAccount;

  test.beforeEach(async ({ context, page }, testInfo) => {
    // A fresh, empty pod per test — no cross-test contamination.
    account = await createCssAccount({
      base: CSS_BASE,
      pod: `t${testInfo.workerIndex}x${Date.now()}`,
    });
    handleLoginPopups(context, account.email, account.password);
    await page.goto("/");
    await page.getByLabel(/your webid/i).fill(account.webId);
    await page.getByRole("button", { name: /sign in/i }).click();
    // Two "New issue" buttons exist (toolbar + empty state) — assert the toolbar one.
    await expect(page.getByRole("button", { name: /new issue/i }).first()).toBeVisible({ timeout: 30_000 });
  });

  test("shows the empty state, then creates an issue that persists across reload", async ({ page }) => {
    await expect(page.getByText(/create your first issue/i)).toBeVisible();

    const title = `Fix login bug ${Math.random().toString(36).slice(2, 8)}`;
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill(title);
    await page.getByLabel(/description/i).fill("Steps to reproduce included.");
    await page.getByRole("button", { name: /create issue/i }).click();

    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

    // The pod is the store: reload, re-auth, and the issue is still there.
    await page.reload();
    await page.getByLabel(/your webid/i).fill(account.webId).catch(() => {});
    await page.getByRole("button", { name: /sign in/i }).click().catch(() => {});
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
  });

  test("closes an issue and finds it under the Closed filter", async ({ page }) => {
    const title = `Closeable ${Math.random().toString(36).slice(2, 8)}`;
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill(title);
    await page.getByRole("button", { name: /create issue/i }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: new RegExp(`actions for ${title}`, "i") }).click();
    await page.getByRole("menuitem", { name: /^close$/i }).click();

    // Default filter is Open — the closed issue leaves the list, then appears under Closed.
    await expect(page.getByRole("heading", { name: title })).toBeHidden({ timeout: 15_000 });
    await page.getByRole("tab", { name: /closed/i }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });
});
