// AUTHORED-BY Codex (GPT-6.1 Sol)
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { seedDemoSession } from "./demo-session";

test.beforeEach(({ page }) => seedDemoSession(page));
test("Trips demo itinerary, manual booking and moving between trips", async ({ page }) => {
  await page.goto("/trips");
  await page.getByRole("button", { name: "A long weekend in Lisbon", exact: true }).click();
  await expect(page.getByText("Casa da Aurora (fictional)", { exact: true })).toBeVisible();
  await expect(page.getByText("Unverified sender", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit trip", exact: true }).click();
  await page.getByLabel("Trip name", { exact: true }).fill("Lisbon, all planned");
  await page.getByRole("button", { name: "Save trip", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Lisbon, all planned", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add booking", exact: true }).click();
  await page.getByLabel("Booking name", { exact: true }).fill("Example onward flight");
  await page.getByLabel("Provider", { exact: true }).fill("Example Air");
  await page.getByLabel("Confirmation number", { exact: true }).fill("DEMO321");
  await page.getByRole("button", { name: "Save booking", exact: true }).click();
  await expect(page.getByText("DEMO321", { exact: true })).toBeVisible();
  await expect(page.getByText("Saving to your pod…", { exact: true })).toBeHidden();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.reload();
  await page.getByRole("button", { name: "Lisbon, all planned", exact: true }).click();
  await expect(page.getByText("DEMO321", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "Move DEMO321 to another trip" }).click();
  await page.getByRole("option", { name: "York by rail", exact: true }).click();
  await expect(page.getByText("DEMO321", { exact: true })).toBeHidden();
  await expect(page.getByText("Saving to your pod…", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Scan my pod", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Suggested trips", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Paste an email", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Email import is coming soon" })).toBeVisible();
});
