// AUTHORED-BY Codex GPT-6
import { expect, type Page } from "@playwright/test";

export async function signInDemo(page: Page) {
  await page.goto("/signin?next=%2Fdrive");
  await page.getByRole("button", { name: "Try it with a demo pod", exact: true }).click();
  await page.waitForURL("/drive");
  await expect(page.getByRole("heading", { name: "Drive", level: 1, exact: true })).toBeVisible();
}
