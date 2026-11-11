// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("demo account can enable hourly summaries and read the digest", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/settings/notifications");
  await page.getByRole("combobox", { name: "Summary schedule" }).click();
  await page.getByRole("option", { name: "Every hour", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "Deliver urgent notifications immediately" }),
  ).toBeChecked();
  await page.goto("/notifications");
  const summary = page.getByRole("region", { name: "Summary", exact: true });
  await expect(summary).toContainText("While you were away:");
  await expect(summary).toContainText("your agent did 4 things");
  await expect(summary).toContainText("1 approval waiting");
  await expect(summary.getByRole("heading", { name: "Your agent" })).toBeVisible();
  const link = summary.getByRole("link").first();
  await expect(link).toHaveAttribute("href", /^#notification-/);
  await link.click();
  await expect(page.locator((await link.getAttribute("href")) as string)).toBeVisible();
  await summary.getByRole("button", { name: "Mark all as read", exact: true }).click();
  await expect(
    summary.getByRole("button", { name: "Mark all as read", exact: true }),
  ).toBeDisabled();
  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.reload();
  await expect(page.getByRole("region", { name: "Summary", exact: true })).toBeVisible();
});
