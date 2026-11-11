// AUTHORED-BY Codex GPT-6
import { expect, type Page } from "@playwright/test";
import { seedDemoSession } from "../demo-session";

export async function signInDemo(page: Page) {
  await seedDemoSession(page);
  await page.goto("/drive");
  await expect(page.getByRole("heading", { name: "Drive", level: 1, exact: true })).toBeVisible();
}
