/**
 * Workspaces e2e: a second project is its own tracker in the pod — issues are
 * isolated per project, the switcher moves between them, and the choice
 * survives a reload.
 */
import { test, expect, type Page } from "@playwright/test";
import { createCssAccount, type CssAccount } from "./css-account";
import { CSS_BASE, dismissToasts, handleLoginPopups, signIn } from "./helpers";

async function createIssue(page: Page, title: string) {
  await page.getByRole("button", { name: /new issue/i }).first().click();
  await page.getByLabel(/^title$/i).fill(title);
  await page.getByRole("button", { name: /create issue/i }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
}

test.describe("Workspaces (multiple projects)", () => {
  let account: CssAccount;

  test.beforeEach(async ({ context, page }, testInfo) => {
    account = await createCssAccount({ base: CSS_BASE, pod: `w${testInfo.workerIndex}x${Date.now()}` });
    handleLoginPopups(context, account.email, account.password);
    await signIn(page, account.webId);
  });

  test("creates a second project, keeps issues isolated, and restores it on reload", async ({ page }) => {
    await createIssue(page, "Default-project issue");

    // Create a new project from the switcher.
    await dismissToasts(page);
    await page.getByRole("button", { name: /switch project/i }).click();
    await page.getByRole("menuitem", { name: /new project/i }).click();
    await page.getByLabel(/project name/i).fill("Website Redesign");
    await page.getByRole("button", { name: /create project/i }).click();

    // Switched into the empty new project — the default issue is not here.
    await expect(page.getByRole("button", { name: /switch project/i })).toContainText(/website redesign/i, {
      timeout: 15_000,
    });
    await expect(page.getByRole("heading", { name: "Default-project issue" })).not.toBeVisible();

    await createIssue(page, "Redesign-only issue");

    // Switch back: each project sees only its own issues.
    await dismissToasts(page);
    await page.getByRole("button", { name: /switch project/i }).click();
    await page.getByRole("menuitem", { name: /^issues$/i }).click();
    await expect(page.getByRole("heading", { name: "Default-project issue" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Redesign-only issue" })).not.toBeVisible();

    // And forward again, then reload — the active project is remembered.
    await page.getByRole("button", { name: /switch project/i }).click();
    await page.getByRole("menuitem", { name: /website redesign/i }).click();
    await expect(page.getByRole("heading", { name: "Redesign-only issue" })).toBeVisible({ timeout: 15_000 });

    await page.reload();
    await page.getByLabel(/your webid/i).fill(account.webId).catch(() => {});
    await page.getByRole("button", { name: /sign in/i }).click().catch(() => {});
    await expect(page.getByRole("heading", { name: "Redesign-only issue" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /switch project/i })).toContainText(/website redesign/i);
  });
});
