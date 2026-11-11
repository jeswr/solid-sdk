// AUTHORED-BY Codex GPT-6.1-Sol
// Screenshot the two corner projects and run axe in all six viewport/theme projects.
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedDemoSession } from "../demo-session";
import { BASELINED } from "./baselines";

test.beforeEach(async ({ page }) => {
  await seedDemoSession(page);
  await page.clock.setFixedTime(new Date("2026-11-11T10:00:00Z"));
});
test("assistant setup and personal-data reads", async ({ page }, info) => {
  await page.goto("/settings/assistants");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Assistants");
  await expect(
    page.getByRole("list", { name: "Personal data reads, newest first" }).getByRole("listitem"),
  ).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  if (BASELINED.has(info.project.name))
    await expect(page).toHaveScreenshot("settings-assistants.png", { fullPage: true });
  await page.getByRole("tab", { name: "ChatGPT", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("Developer mode needs a paid plan");
  if (BASELINED.has(info.project.name))
    await expect(page).toHaveScreenshot("settings-assistants-chatgpt.png", { fullPage: true });
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
});
