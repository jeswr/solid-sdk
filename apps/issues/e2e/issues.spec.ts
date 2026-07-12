/**
 * Golden-path e2e against a real local CSS. Each write test gets a fresh account
 * (createCssAccount) so the pod starts empty and tests don't interfere.
 */
import { test, expect } from "@playwright/test";
import { createCssAccount, type CssAccount } from "./css-account";
import { CSS_BASE, handleLoginPopups, signIn } from "./helpers";

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
    await page.getByLabel(/your webid/i).fill("http://localhost:9999/profile/card#me");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.locator('[role="alert"]').filter({ hasText: /\S/ })).toBeVisible({ timeout: 20_000 });
  });
});

test.describe("Issues (authenticated)", () => {
  let account: CssAccount;

  test.beforeEach(async ({ context, page }, testInfo) => {
    account = await createCssAccount({ base: CSS_BASE, pod: `t${testInfo.workerIndex}x${Date.now()}` });
    handleLoginPopups(context, account.email, account.password);
    await signIn(page, account.webId);
  });

  test("shows the empty state, then creates an issue that persists across reload", async ({ page }) => {
    await expect(page.getByText(/create your first issue/i)).toBeVisible();

    const title = `Fix login bug ${Math.random().toString(36).slice(2, 8)}`;
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill(title);
    await page.getByLabel(/description/i).fill("Steps to reproduce included.");
    await page.getByRole("button", { name: /create issue/i }).click();

    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

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

    await expect(page.getByRole("heading", { name: title })).toBeHidden({ timeout: 15_000 });
    await page.getByRole("tab", { name: /closed/i }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });
});
