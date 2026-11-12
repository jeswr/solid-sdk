// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { readFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import type { IWorkbookData } from "@univerjs/core";
import { strFromU8, unzipSync } from "fflate";
import { accessible, fileMenu, test, waitForEngine } from "./fixtures";

test("creates formulas and formatting, adds a sheet and chart, exports CSV/XLSX and restores on reload", async ({
  page,
}, info) => {
  await page.goto("/sheets");
  await expect(page.getByRole("heading", { name: "No spreadsheets yet" })).toBeVisible();
  await accessible(page, info, "empty-list");
  await page.getByRole("link", { name: "New spreadsheet", exact: true }).click();
  await expect(page).toHaveURL(/\/sheets\/s\//);
  await waitForEngine(page);
  // A1 is directly beneath the column header. All edits go through real keyboard input.
  const canvas = page
    .locator(
      '[data-testid="univer-container"] canvas[data-u-comp="render-canvas"][id^="univer-sheet-main-canvas"]',
    )
    .first();
  await canvas.click({ position: { x: 80, y: 32 } });
  for (const value of ["1", "2", "3", "=SUM(A1:A3)"]) {
    await page.keyboard.type(value);
    await page.keyboard.press("Enter");
  }
  await expect
    .poll(() => page.evaluate(() => window.__sheetsEngine?.exportCsv()))
    .toBe("1\r\n2\r\n3\r\n6\r\n");
  await canvas.click({ position: { x: 80, y: 32 } });
  await page.keyboard.press("Control+b");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const snapshot = window.__sheetsEngine?.snapshot() as unknown as IWorkbookData | undefined;
        const sheet = window.__sheetsEngine?.activeSheet().id;
        const cells = sheet ? snapshot?.sheets?.[sheet]?.cellData : undefined;
        const style = cells?.["0"]?.["0"]?.s;
        return typeof style === "string" ? snapshot?.styles?.[style]?.bl : style?.bl;
      }),
    )
    .toBe(1);
  await page.locator('[data-u-comp="sheet-bar-append-button"]').first().click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window.__sheetsEngine?.snapshot().sheetOrder as string[] | undefined)?.length,
      ),
    )
    .toBe(2);
  // Switch back using the sheet bar, so the download covers the formula's cached value.
  await page.getByTestId("univer-container").getByText("Sheet1", { exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => window.__sheetsEngine?.activeSheet().name))
    .toBe("Sheet1");
  const selectedRange = await page.evaluate(() => window.__sheetsEngine?.selection?.().range);
  await page.getByRole("button", { name: "Insert chart", exact: true }).click();
  await expect(page.getByLabel("Data range (A1)")).toHaveValue(selectedRange as string);
  await page.getByLabel("Data range (A1)").fill("A1:A4");
  await page.getByLabel("Chart title", { exact: true }).fill("Totals");
  await page.getByLabel("Chart type").selectOption("line");
  await page.getByRole("button", { name: "Insert", exact: true }).click();
  await expect(page.getByRole("img", { name: /^Totals/ })).toBeVisible();
  await expect(page.getByText("Saved to your pod", { exact: true })).toBeVisible();
  await accessible(page, info, "editor-with-chart");
  await page.getByRole("button", { name: "File", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download current sheet as CSV", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("Untitled spreadsheet - Sheet1.csv");
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(await readFile(path as string, "utf8")).toBe("1\r\n2\r\n3\r\n6\r\n");
  const excelDownload = page.waitForEvent("download");
  await fileMenu(page, "Download as Excel (.xlsx)");
  const excel = await excelDownload;
  expect(excel.suggestedFilename()).toBe("Untitled spreadsheet.xlsx");
  const excelPath = await excel.path();
  expect(excelPath).toBeTruthy();
  // The XLSX reader needs a browser DOMParser; inspect the package parts directly here.
  const parts = unzipSync(new Uint8Array(await readFile(excelPath as string)));
  expect(strFromU8(parts["xl/workbook.xml"] as Uint8Array).match(/<sheet /g)).toHaveLength(2);
  const firstSheet = strFromU8(parts["xl/worksheets/sheet1.xml"] as Uint8Array);
  expect(firstSheet).toMatch(/<c r="A1"[^>]*><v>1<\/v>/);
  expect(firstSheet).toMatch(/<c r="A4"[^>]*><f>SUM\(A1:A3\)<\/f>/);
  await page.reload();
  await waitForEngine(page);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window.__sheetsEngine?.snapshot().sheetOrder as string[] | undefined)?.length,
      ),
    )
    .toBe(2);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const engine = window.__sheetsEngine;
        const first = (engine?.snapshot().sheetOrder as string[] | undefined)?.[0];
        return first ? engine?.exportCsv(first) : undefined;
      }),
    )
    .toBe("1\r\n2\r\n3\r\n6\r\n");
  await expect(page.getByRole("img", { name: /^Totals/ })).toBeVisible();
  await page.getByRole("button", { name: "Edit chart", exact: true }).click();
  await page.getByLabel("Chart type").selectOption("bar");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.getByRole("button", { name: "Edit chart", exact: true }).click();
  await page.getByRole("button", { name: "Delete chart", exact: true }).click();
  await expect(page.getByRole("img", { name: /^Totals/ })).toHaveCount(0);
  await expect(page.getByText("Saved to your pod", { exact: true })).toBeVisible();
});

test("invalid references have a useful not-found state", async ({ page }) => {
  await page.goto("/sheets/s/not!a!ref");
  await expect(page.getByRole("heading", { name: "This item isn't here any more" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to spreadsheets" })).toHaveAttribute(
    "href",
    "/sheets",
  );
});

test("edits and scrolls sheet tabs without page overflow", async ({ page }) => {
  await page.goto("/sheets/new");
  await waitForEngine(page);
  const grid = page.getByTestId("univer-container");
  await expect(grid.locator('[data-u-comp="formula-bar"]')).toBeVisible();
  await expect(grid.getByRole("tablist", { name: "Sheet tabs" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
  const canvas = grid
    .locator('canvas[data-u-comp="render-canvas"][id^="univer-sheet-main-canvas"]')
    .first();
  await canvas.click({ position: { x: 80, y: 32 } });
  await page.keyboard.type("Mobile edit");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => window.__sheetsEngine?.exportCsv()))
    .toBe("Mobile edit\r\n");
  const add = grid.locator('[data-u-comp="sheet-bar-append-button"]').first();
  for (let index = 0; index < 8; index++) await add.click();
  await expect(add).toBeInViewport();
  await expect(grid.getByRole("tablist", { name: "Sheet tabs" })).toBeVisible();
  await expect(page.getByText("Saved to your pod", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("persists a cell comment and its workbook anchor across reload", async ({ page }) => {
  await page.goto("/sheets/new");
  await waitForEngine(page);
  await page.evaluate(() => {
    const engine = window.__sheetsEngine;
    const sheetId = engine?.activeSheet().id;
    if (sheetId) engine?.selectCell?.({ sheetId, cell: "B3", deleted: false });
  });
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await page.getByLabel("Comment on B3").fill("Review this cell");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Comment sent.", { exact: true })).toBeVisible();
  await expect(page.getByText("Review this cell", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reply", exact: true }).click();
  await page.getByLabel("Reply text").fill("Checked the total");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByText("Checked the total", { exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__sheetsEngine?.snapshot().commentAnchors))
    .toMatchObject({ version: 1 });
  await expect(page.getByText("Saved to your pod", { exact: true })).toBeVisible();
  await page.reload();
  await waitForEngine(page);
  await page.getByRole("button", { name: /^Comments \(/ }).click();
  await expect(page.getByText("Review this cell", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sheet1!B3", exact: true })).toBeEnabled();
  await expect(page.getByText("Checked the total", { exact: true })).toBeVisible();
});
