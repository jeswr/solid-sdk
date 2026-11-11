// AUTHORED-BY Codex GPT-6
import { expect, test } from "@playwright/test";
import { signInDemo } from "./fixtures";

test("Drive details open, close and reopen", async ({ page }) => {
  await signInDemo(page);
  const show = page.getByRole("button", { name: "Show details", exact: true });
  await show.click();
  await expect(
    page.getByRole("button", { name: "Hide details", exact: true, includeHidden: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Close details", exact: true }).first().click();
  await expect(show).toBeVisible();
  await show.click();
  await expect(
    page.getByRole("button", { name: "Close details", exact: true }).first(),
  ).toBeVisible();
});
