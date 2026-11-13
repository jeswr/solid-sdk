// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedDemoSession } from "../demo-session";

test.beforeEach(({ page }) => seedDemoSession(page));

test("demo Home card opens Shared with me, filters apps and opens a document", async ({ page }) => {
  await page.goto("/home");
  const card = page.getByRole("region", { name: "Shared with you", exact: true });
  await expect(card.getByRole("link", { name: "Launch plan", exact: true })).toBeVisible();
  await expect(card.getByRole("listitem")).toHaveCount(4);
  await card.getByRole("link", { name: "View all shared items" }).click();
  await expect(page).toHaveURL("/shared");
  await expect(
    page.getByRole("heading", { level: 1, name: "Shared with me", exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle(/Shared with me/);
  const list = page.getByRole("list", { name: "Shared items" });
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await expect(list.getByText("bob.demo.pod", { exact: false })).toBeVisible();
  await page
    .getByRole("group", { name: "Filter shared items by app" })
    .getByRole("button", { name: "Sheets", exact: true })
    .click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  await expect(list.getByRole("link", { name: "Trip budget", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await page.getByRole("button", { name: "Docs", exact: true }).click();
  await expect(list.getByRole("listitem")).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((item) => item.impact === "serious" || item.impact === "critical"),
  ).toEqual([]);
  await list.getByRole("link", { name: "Launch plan", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/d\//);
  await expect(page.getByRole("textbox", { name: "Document title" })).toHaveValue("Launch plan");
});

test("removing a share persists across the page and Home card", async ({ page }) => {
  await page.goto("/shared");
  const list = page.getByRole("list", { name: "Shared items" });
  await expect(list.getByRole("listitem")).toHaveCount(4);
  await page
    .getByRole("button", { name: "Remove Trip budget from Shared with me", exact: true })
    .click();
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await page.reload();
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await page.goto("/home");
  const card = page.getByRole("region", { name: "Shared with you", exact: true });
  await expect(card.getByRole("listitem")).toHaveCount(3);
  await expect(card.getByRole("link", { name: "Trip budget", exact: true })).toHaveCount(0);
});
