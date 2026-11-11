// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { seedDemoSession } from "../demo-session";

export async function openAgent(page: Page, route: string) {
  // The agent sits behind the shell's session guard, like every other real app route.
  await seedDemoSession(page);
  await page.goto(`/agent/${route}`);
  await page.waitForFunction(() => !!window.__suiteDemoPod);
  await expect(
    page.getByRole("heading", { level: 1 }).filter({ visible: true }).first(),
  ).toBeVisible();
}
export async function agentScreenshot(page: Page, info: TestInfo, name: string) {
  const report = await new AxeBuilder({ page }).analyze();
  expect(
    report.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const directory = fileURLToPath(
    new URL("../../../../artifacts/playwright/agent/", import.meta.url),
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${name}-${info.project.name}.png`, fullPage: true });
}
export async function setupAgentKey(page: Page) {
  await openAgent(page, "settings");
  await page.getByRole("button", { name: "Set up this device", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Set up this device", exact: true })
    .click();
  await expect(page.getByText("Key ready", { exact: true })).toBeVisible();
}
