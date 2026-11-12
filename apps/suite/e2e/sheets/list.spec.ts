// AUTHORED-BY Codex GPT-6.1-Sol
import { expect } from "@playwright/test";
import { accessible, test, waitForEngine } from "./fixtures";

test("renames, filters, opens and deletes a spreadsheet from the list", async ({ page }, info) => {
  await page.goto("/sheets/new");
  await waitForEngine(page);
  await page.getByRole("link", { name: "Back to spreadsheets", exact: true }).click();
  await expect(page.getByRole("table", { name: "Your spreadsheets" })).toBeVisible();
  await accessible(page, info, "populated-list");
  await page.getByRole("button", { name: "Actions for Untitled spreadsheet" }).click();
  await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename spreadsheet" });
  await rename.getByRole("textbox", { name: "Name", exact: true }).fill("Quarterly budget");
  await accessible(page, info, "rename-dialog");
  await rename.getByRole("button", { name: "Save", exact: true }).click();
  await expect(rename).toBeHidden();
  const row = page.getByRole("link", { name: /^Quarterly budget/ });
  await expect(row).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search spreadsheets", exact: true });
  await search.fill("bUdGeT");
  await expect(row).toBeVisible();
  await search.fill("No matching workbook");
  await expect(
    page.getByRole("heading", { name: "No results for 'No matching workbook'" }),
  ).toBeVisible();
  await expect(row).toBeHidden();
  await accessible(page, info, "empty-search");
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await expect(search).toHaveValue("");
  await row.click();
  await waitForEngine(page);
  await expect(page.getByRole("heading", { name: "Quarterly budget", exact: true })).toBeAttached();
  await page.getByRole("link", { name: "Back to spreadsheets", exact: true }).click();
  await page.getByRole("button", { name: "Actions for Quarterly budget" }).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  const remove = page.getByRole("alertdialog", { name: "Delete spreadsheet?" });
  await accessible(page, info, "delete-dialog");
  await remove.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No spreadsheets yet" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "No spreadsheets yet" })).toBeVisible();
});
