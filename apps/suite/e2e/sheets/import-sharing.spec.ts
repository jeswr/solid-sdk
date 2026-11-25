// AUTHORED-BY Codex GPT-6.1-Sol
import { expect } from "@playwright/test";
import { accessible, fileMenu, test, waitForEngine } from "./fixtures";

test("imports a CSV into a new sheet, persists it, and opens sharing", async ({ page }, info) => {
  await page.goto("/sheets/new");
  await waitForEngine(page);
  await fileMenu(page, "Import CSV");
  const dialog = page.getByRole("dialog", { name: "Import CSV", exact: true });
  await expect(dialog.getByRole("radio", { name: "Insert as new sheet" })).toBeChecked();
  await accessible(page, info, "import-dialog");
  await dialog.getByLabel("CSV file to import").setInputFiles("e2e/fixtures/sheets-import.csv");
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.__sheetsEngine?.activeSheet().name))
    .toBe("sheets-import");
  await expect
    .poll(() => page.evaluate(() => window.__sheetsEngine?.exportCsv()))
    .toBe('Item,Amount\r\nApples,12\r\n"Pears, ripe",18\r\n');
  await expect(page.getByText("Saved to your pod", { exact: true })).toBeVisible();
  await page.reload();
  await waitForEngine(page);
  await page.getByTestId("univer-container").getByText("sheets-import", { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__sheetsEngine?.exportCsv()))
    .toContain("Apples,12");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Share Untitled spreadsheet" });
  await expect(share).toBeVisible();
  await expect(share.getByRole("button", { name: "Copy link", exact: true })).toBeVisible();
  await accessible(page, info, "share-dialog");
  await share.getByRole("button", { name: "Done", exact: true }).click();
  await expect(share).toBeHidden();
});

test("opens data validation and conditional formatting from the Data ribbon", async ({ page }) => {
  // Compact phone mode deliberately hides the ribbon; the wide projects cover these controls.
  test.skip((page.viewportSize()?.width ?? 0) < 640, "The compact editor has no ribbon");
  await page.goto("/sheets/new");
  await waitForEngine(page);
  const grid = page.getByTestId("univer-container");
  await grid.getByRole("tab", { name: "Data", exact: true }).click();
  await grid.getByRole("button", { name: "Data validation", exact: true }).click();
  await page.getByText("Data validation management", { exact: true }).click();
  const sidebar = grid.locator('[data-u-comp="sidebar"][aria-expanded="true"]');
  await expect(sidebar.getByText("Data validation management", { exact: true })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "Add Rule", exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "Close sidebar", exact: true }).click();
  await grid.getByRole("button", { name: "Conditional Formatting", exact: true }).click();
  await page.getByText("Manage Conditional Formatting", { exact: true }).click();
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText("Conditional Formatting", { exact: true })).toBeVisible();
});
