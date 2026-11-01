// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import type { SheetEngine } from "../src/apps/sheets/lib/contract";

declare global {
  interface Window {
    // biome-ignore lint/style/useNamingConvention: explicitly contracted development fixture
    __sheetsEngine?: SheetEngine;
  }
}

test.beforeEach(async ({ page }) => {
  await page.route("**/__sheets-test-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset Sheets</title>" }),
  );
  await page.goto("/__sheets-test-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo pod reset blocked"));
    });
  });
  await page.unroute("**/__sheets-test-reset");
});

async function capture(page: Page, info: TestInfo, view: "list" | "editor") {
  const directory = fileURLToPath(
    new URL("../../../artifacts/playwright/sheets/", import.meta.url),
  );
  await mkdir(directory, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${directory}/${info.project.name}-${view}.png`, fullPage: true });
}

async function waitForEngine(page: Page) {
  await expect
    .poll(() => page.evaluate(() => Boolean(window.__sheetsEngine)), { timeout: 30000 })
    .toBe(true);
  await expect(page.getByRole("region", { name: "Spreadsheet grid" })).toBeVisible();
}

test("create, edit, add a sheet, download CSV, and persist across reload", async ({
  page,
}, info) => {
  await page.goto("/sheets");
  await expect(page.getByRole("heading", { name: "No spreadsheets yet" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await capture(page, info, "list");
  await page
    .locator(".sht-state")
    .getByRole("button", { name: "New spreadsheet", exact: true })
    .click();
  await expect(page).toHaveURL(/\/sheets\/s\//);
  await waitForEngine(page);
  // A1 is directly beneath the column header. All edits go through real keyboard input.
  const canvas = page
    .locator('[data-testid="univer-container"] canvas[data-u-comp="render-canvas"]')
    .first();
  await canvas.click({ position: { x: 80, y: 32 } });
  for (const value of ["1", "2", "3", "=SUM(A1:A3)"]) {
    await page.keyboard.type(value);
    await page.keyboard.press("Enter");
  }
  await expect
    .poll(() => page.evaluate(() => window.__sheetsEngine?.exportCsv()))
    .toBe("1\r\n2\r\n3\r\n6\r\n");
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
  await expect(page.getByText("Saved to your pod", { exact: true })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).exclude('[data-testid="univer-container"]').analyze())
      .violations,
  ).toEqual([]);
  await capture(page, info, "editor");
  await page.getByRole("button", { name: "File", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download current sheet as CSV", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("Untitled spreadsheet - Sheet1.csv");
  const path = await download.path();
  expect(path).toBeTruthy();
  expect(await readFile(path as string, "utf8")).toBe("1\r\n2\r\n3\r\n6\r\n");
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
});

test("invalid references have a useful not-found state", async ({ page }) => {
  await page.goto("/sheets/s/not!a!ref");
  await expect(page.getByRole("heading", { name: "Can't open this spreadsheet" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to spreadsheets" })).toHaveAttribute(
    "href",
    "/sheets",
  );
});
