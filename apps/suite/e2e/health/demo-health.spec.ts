// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "@playwright/test";

test("demo sign-in opens Health and saves a measurement across reload", async ({ page }) => {
  await page.goto("/signin");
  await page.getByRole("button", { name: "Try it with a demo pod", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/health");
  await expect(page.getByRole("heading", { level: 1, name: "Summary", exact: true })).toBeVisible();
  const add = page.getByRole("button", { name: "Add measurement", exact: true }).first();
  await expect(add).toBeEnabled();
  await expect(page.getByText("Health storage needs attention", { exact: true })).toHaveCount(0);
  await add.click();
  const sheet = page.getByRole("dialog", { name: "Add measurement", exact: true });
  await sheet.getByLabel("Metric", { exact: true }).selectOption("weight");
  await sheet.getByLabel("Value", { exact: true }).fill("76.3");
  await sheet.getByRole("button", { name: "Save measurement", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByTestId("health-card-weight")).toContainText("76.3");
  // The form is optimistic. Wait for the durable pod write before reloading the page.
  await expect(page.getByText("Measurement saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("health-card-weight")).toContainText("76.3");
  await expect(
    page.getByRole("button", { name: "Add measurement", exact: true }).first(),
  ).toBeEnabled();
  await expect(page.getByText("Health storage needs attention", { exact: true })).toHaveCount(0);
});
