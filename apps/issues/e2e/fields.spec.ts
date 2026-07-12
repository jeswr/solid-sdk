/**
 * Custom-fields e2e: define fields on the tracker, set values from the issue
 * form, read them back in the detail view — all persisted in the pod.
 */
import { test, expect } from "@playwright/test";
import { createCssAccount, type CssAccount } from "./css-account";
import { CSS_BASE, dismissToasts, handleLoginPopups, signIn } from "./helpers";

test.describe("Custom fields", () => {
  let account: CssAccount;

  test.beforeEach(async ({ context, page }, testInfo) => {
    account = await createCssAccount({ base: CSS_BASE, pod: `f${testInfo.workerIndex}x${Date.now()}` });
    handleLoginPopups(context, account.email, account.password);
    await signIn(page, account.webId);
  });

  test("defines fields, fills them on an issue, and the values persist", async ({ page }) => {
    // Define a select field and a text field.
    await page.getByRole("button", { name: /fields/i }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/field name/i).fill("Stage");
    await dialog.getByLabel(/^type$/i).click();
    await page.getByRole("option", { name: /^select$/i }).click();
    await dialog.getByLabel(/options/i).fill("Alpha, Beta, GA");
    await dialog.getByRole("button", { name: /add field/i }).click();
    await expect(dialog.getByText("Alpha · Beta · GA")).toBeVisible({ timeout: 15_000 });

    await dialog.getByLabel(/field name/i).fill("Customer");
    await dialog.getByRole("button", { name: /add field/i }).click();
    await expect(dialog.getByText("Customer")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");

    // Create an issue with both values set.
    await dismissToasts(page);
    await page.getByRole("button", { name: /new issue/i }).first().click();
    await page.getByLabel(/^title$/i).fill("Field-bearing issue");
    await page.getByLabel(/^stage$/i).click();
    await page.getByRole("option", { name: /^beta$/i }).click();
    await page.getByLabel(/^customer$/i).fill("ACME Corp");
    await page.getByRole("button", { name: /create issue/i }).click();
    await expect(page.getByRole("heading", { name: "Field-bearing issue" })).toBeVisible({ timeout: 15_000 });

    // The detail view shows formatted values (select shows the option label).
    await page.getByRole("heading", { name: "Field-bearing issue" }).click();
    const detail = page.getByRole("dialog");
    await expect(detail.getByText("Stage", { exact: true })).toBeVisible();
    await expect(detail.getByText("Beta", { exact: true })).toBeVisible();
    await expect(detail.getByText("ACME Corp")).toBeVisible();
    await page.keyboard.press("Escape");

    // Values survive a reload (they live in the pod, not the session).
    await page.reload();
    await page.getByLabel(/your webid/i).fill(account.webId).catch(() => {});
    await page.getByRole("button", { name: /sign in/i }).click().catch(() => {});
    await expect(page.getByRole("heading", { name: "Field-bearing issue" })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("heading", { name: "Field-bearing issue" }).click();
    await expect(page.getByRole("dialog").getByText("ACME Corp")).toBeVisible();
  });
});
