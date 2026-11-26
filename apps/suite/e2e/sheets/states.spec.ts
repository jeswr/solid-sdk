// AUTHORED-BY Codex GPT-6.1-Sol
import { expect } from "@playwright/test";
import { DEMO_ROOT } from "../../src/lib/demo-pod/constants";
import { decodeRef, encodeRef } from "../../src/lib/refs";
import { accessible, test, waitForEngine } from "./fixtures";

test("a list load error retries without losing saved spreadsheets", async ({ page }, info) => {
  await page.goto("/sheets/new");
  await waitForEngine(page);
  await page.evaluate(
    (root) => sessionStorage.setItem("sheets-fail-resource", `${root}sheets/`),
    DEMO_ROOT,
  );
  await page.goto("/sheets");
  await expect(page.locator('[role="alert"][data-category]')).toContainText(
    "Couldn't load your spreadsheets",
  );
  await accessible(page, info, "list-error");
  await page.evaluate(() => sessionStorage.removeItem("sheets-fail-resource"));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByRole("link", { name: /^Untitled spreadsheet/ })).toBeVisible();
});

test("an editor load error retries and a missing workbook has a way back", async ({
  page,
}, info) => {
  await page.goto("/sheets/new");
  await waitForEngine(page);
  const container = decodeRef(new URL(page.url()).pathname.split("/").at(-1) as string);
  await page.evaluate(
    (url) => sessionStorage.setItem("sheets-fail-resource", `${url}workbook.json`),
    container,
  );
  await page.reload();
  await expect(page.locator('[role="alert"][data-category]')).toContainText(
    "Couldn't open this spreadsheet",
  );
  await accessible(page, info, "editor-error");
  await page.evaluate(() => sessionStorage.removeItem("sheets-fail-resource"));
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await waitForEngine(page);
  await page.goto(`/sheets/s/${encodeRef(`${DEMO_ROOT}sheets/missing/`)}`);
  await expect(page.locator('[data-category="not-found"]')).toBeVisible();
  await accessible(page, info, "missing-workbook");
  await page.getByRole("link", { name: "Back to spreadsheets", exact: true }).click();
  await expect(page.getByRole("heading", { name: "All spreadsheets" })).toBeVisible();
});

test("view-only access disables mutations and still permits downloading", async ({
  page,
}, info) => {
  await page.goto("/sheets/new");
  await waitForEngine(page);
  const container = decodeRef(new URL(page.url()).pathname.split("/").at(-1) as string);
  await page.evaluate((url) => sessionStorage.setItem("sheets-read-only", url), container);
  await page.reload();
  await waitForEngine(page, false);
  await expect(
    page.getByRole("status").filter({ hasText: "View only. Download a copy" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
  const before = await page.evaluate(() => window.__sheetsEngine?.exportCsv());
  const canvas = page
    .getByTestId("univer-container")
    .locator('canvas[data-u-comp="render-canvas"][id^="univer-sheet-main-canvas"]')
    .first();
  await canvas.click({ position: { x: 80, y: 32 } });
  await page.keyboard.type("Blocked edit");
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__sheetsEngine?.exportCsv())).toBe(before);
  // Univer's own "range is protected" popover (third-party, outside the grid) is dismissed first.
  await page.keyboard.press("Escape");
  await accessible(page, info, "view-only-editor");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "Import CSV", exact: true })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeDisabled();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Download current sheet as CSV", exact: true }).click();
  expect((await downloading).suggestedFilename()).toMatch(/\.csv$/);
});

test("offline edits explain their status and save on reconnection", async ({ page }, info) => {
  await page.goto("/sheets/new");
  await waitForEngine(page);
  await page.evaluate(() => {
    sessionStorage.setItem("sheets-offline", "1");
    dispatchEvent(new Event("offline"));
  });
  await expect(
    page.getByText("You're offline. Reconnect to load or share spreadsheets.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
  const canvas = page
    .getByTestId("univer-container")
    .locator('canvas[data-u-comp="render-canvas"][id^="univer-sheet-main-canvas"]')
    .first();
  await canvas.click({ position: { x: 80, y: 32 } });
  await page.keyboard.type("Offline draft");
  await page.keyboard.press("Enter");
  await expect(
    page.getByText("Offline — changes will save when you reconnect", { exact: true }),
  ).toBeVisible();
  await accessible(page, info, "offline-editor");
  await page.evaluate(() => {
    sessionStorage.removeItem("sheets-offline");
    dispatchEvent(new Event("online"));
  });
  await expect(page.getByText("Saved to your pod", { exact: true })).toBeVisible();
  await page.reload();
  await waitForEngine(page);
  await expect
    .poll(() => page.evaluate(() => window.__sheetsEngine?.exportCsv()))
    .toBe("Offline draft\r\n");
});
