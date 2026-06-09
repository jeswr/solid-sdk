/**
 * Milestone-3 e2e: priority + labels on an issue, and the comments thread — all
 * persisted to per-issue documents in a real local CSS pod.
 */
import { test, expect } from "@playwright/test";
import { createCssAccount, type CssAccount } from "./css-account";
import { CSS_BASE, handleLoginPopups, signIn } from "./helpers";

test.describe("Advanced issue features", () => {
  let account: CssAccount;

  test.beforeEach(async ({ context, page }, testInfo) => {
    account = await createCssAccount({ base: CSS_BASE, pod: `m3-${testInfo.workerIndex}-${Date.now()}` });
    handleLoginPopups(context, account.email, account.password);
    await signIn(page, account.webId);
  });

  test("creates an issue with a priority and a label", async ({ page }) => {
    const title = `Priority issue ${Math.random().toString(36).slice(2, 8)}`;
    await page.getByRole("button", { name: /new issue/i }).first().click();

    await page.getByLabel(/^title$/i).fill(title);
    await page.locator("#priority").click();
    await page.getByRole("option", { name: "High" }).click();
    await page.getByLabel(/labels/i).fill("bug");
    await page.getByRole("button", { name: /create issue/i }).click();

    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("high", { exact: true })).toBeVisible();
    await expect(page.getByText("bug", { exact: true })).toBeVisible();
  });

  test("searches issues and switches to the board view", async ({ page }) => {
    for (const title of ["Alpha login bug", "Beta dark mode"]) {
      await page.getByRole("button", { name: /new issue/i }).first().click();
      await page.getByLabel(/^title$/i).fill(title);
      await page.getByRole("button", { name: /create issue/i }).click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    }

    // Search narrows the list.
    await page.getByLabel(/search issues/i).fill("Alpha");
    await expect(page.getByRole("heading", { name: "Alpha login bug" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Beta dark mode" })).toBeHidden();

    // Clear, switch to the board view — status columns render (To Do / In Progress / Done).
    await page.getByLabel(/search issues/i).fill("");
    await page.getByRole("tab", { name: /board view/i }).click();
    await expect(page.getByRole("region", { name: /to do/i })).toBeVisible();
    await expect(page.getByRole("region", { name: /in progress/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Alpha login bug" })).toBeVisible();

    // Switch grouping to priority.
    await page.getByLabel(/group by/i).click();
    await page.getByRole("option", { name: /priority/i }).click();
    await expect(page.getByRole("region", { name: /no priority/i })).toBeVisible();
  });

  test("changes an issue's status via the edit form", async ({ page }) => {
    const title = `Status flow ${Math.random().toString(36).slice(2, 6)}`;
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill(title);
    await page.getByRole("button", { name: /create issue/i }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

    // Edit → set status In Progress.
    await page.getByRole("button", { name: new RegExp(`actions for ${title}`, "i") }).click();
    await page.getByRole("menuitem", { name: /edit/i }).click();
    await page.locator("#status").click();
    await page.getByRole("option", { name: /in progress/i }).click();
    await page.getByRole("button", { name: /save changes/i }).click();

    await expect(page.getByText(/in progress/i).first()).toBeVisible({ timeout: 15_000 });
  });

  test("bulk-closes selected issues", async ({ page }) => {
    const titles = [`Bulk one ${Math.random().toString(36).slice(2, 6)}`, `Bulk two ${Math.random().toString(36).slice(2, 6)}`];
    for (const title of titles) {
      await page.getByRole("button", { name: /new issue/i }).first().click();
      await page.getByLabel(/^title$/i).fill(title);
      await page.getByRole("button", { name: /create issue/i }).click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });
    }

    await page.getByLabel(/select all issues/i).click();
    await expect(page.getByText(/2 selected/i)).toBeVisible();
    await page.getByRole("button", { name: /^close$/i }).click();
    await expect(page.getByText(/2 selected/i)).toBeHidden({ timeout: 15_000 }); // selection cleared after bulk op

    // Default filter is Open — both closed issues leave the list.
    for (const title of titles) await expect(page.getByRole("heading", { name: title })).toBeHidden({ timeout: 15_000 });
    await page.getByRole("tab", { name: /closed/i }).click();
    for (const title of titles) await expect(page.getByRole("heading", { name: title })).toBeVisible();
  });

  test("adds a comment to an issue and it persists", async ({ page }) => {
    const title = `Discuss ${Math.random().toString(36).slice(2, 8)}`;
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill(title);
    await page.getByRole("button", { name: /create issue/i }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: new RegExp(`actions for ${title}`, "i") }).click();
    await page.getByRole("menuitem", { name: /comments/i }).click();

    const comment = `Looking into it ${Math.random().toString(36).slice(2, 6)}`;
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/add a comment/i).fill(comment);
    await dialog.getByRole("button", { name: /^comment$/i }).click();

    // The thread re-renders from a fresh pod read after posting (the hook re-fetches
    // CSS), so seeing the comment here proves it persisted to the issue document.
    await expect(dialog.getByText(comment)).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(/1 comment/i)).toBeVisible();
  });
});
