// AUTHORED-BY Codex (GPT-6.1 Sol)
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.use({ locale: "en-GB", timezoneId: "Europe/London" });
test("demo findings, pair exploration, trends, sources and offline browsing", async ({
  page,
  context,
}) => {
  await page.clock.setFixedTime(new Date("2026-11-11T15:00:00Z"));
  await page.goto("/welcome?next=%2Finsights");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/insights\/?$/);
  // The first visit seeds 120 fictional days into the demo pod, which can take a while.
  await expect(page.getByRole("heading", { name: "Connections worth exploring" })).toBeVisible({
    timeout: 30_000,
  });
  const findings = page.getByRole("region", { name: "Top findings" });
  await expect(findings.locator("article").first()).toBeVisible();
  await expect(findings.getByRole("figure").first()).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Insights views" });
  await navigation.getByRole("link", { name: "Explore", exact: true }).click();
  await page.getByRole("combobox", { name: "First series (X)" }).click();
  await page.getByRole("option", { name: "Steps", exact: true }).click();
  await page.getByRole("combobox", { name: "Second series (Y)" }).click();
  await page.getByRole("option", { name: "Sleep", exact: true }).click();
  await page.getByRole("combobox", { name: "Compare Y" }).click();
  await page.getByRole("option", { name: "1 day(s) later", exact: true }).click();
  await expect(page.getByText("X today, Y 1 day(s) later.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pearson r", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show table for Steps and Sleep", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await navigation.getByRole("link", { name: "Trends", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Trends", exact: true })).toBeVisible();
  await expect(page.getByText("Weekday pattern", { exact: true }).first()).toBeVisible();
  await page
    .getByRole("button", { name: "Show table for 30-day rolling average", exact: true })
    .first()
    .click();
  await expect(page.getByRole("table").first()).toBeVisible();
  await navigation.getByRole("link", { name: "Sources", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Health", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Money", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Music", exact: true })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await context.setOffline(true);
  await expect(
    page.getByText("You're offline. You can explore data already loaded here.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh sources", exact: true })).toBeDisabled();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Health", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await context.setOffline(false);
});
