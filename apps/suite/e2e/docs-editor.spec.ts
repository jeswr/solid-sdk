// AUTHORED-BY Codex
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
}
async function newDocument(page: Page, title: string) {
  await page.goto("/docs/new");
  const titleInput = page.getByRole("textbox", { name: "Document title", exact: true });
  await expect(titleInput).toBeVisible();
  await titleInput.fill(title);
  await titleInput.press("Enter");
  return page.getByRole("textbox", { name: "Document body", exact: true });
}
/**
 * ProseMirror learns of a keyboard-moved caret from the asynchronous selectionchange
 * event, and TipTap restores focus on the next animation frame. Let both settle before
 * the next key, as a person's typing would.
 */
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function format(page: Page, label: string) {
  const button = page
    .getByRole("toolbar", { name: "Formatting", exact: true })
    .getByRole("button", { name: label, exact: true });
  if (await button.isVisible()) await button.click();
  else {
    await page.getByRole("button", { name: "More formatting", exact: true }).click();
    await page.getByRole("menuitem", { name: label, exact: false }).first().click();
  }
}

test("creates, saves, reloads and formats a document accessibly", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mkdir("e2e/screenshots", { recursive: true });
  const suffix = testInfo.project.name;
  await page.goto("/docs");
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No documents yet" })).toBeVisible();
  await audit(page);
  await page
    .getByRole("link", { name: "New document", exact: true })
    .filter({ visible: true })
    .last()
    .click();
  await expect(page).toHaveURL(/\/docs\/new\?draft=[0-9a-f-]+$/);
  const title = page.getByRole("textbox", { name: "Document title", exact: true });
  await title.fill("Launch plan");
  await title.press("Enter");
  const body = page.getByRole("textbox", { name: "Document body", exact: true });
  await body.pressSequentially("A clear plan for the launch.");
  await body.press("Enter");
  await body.pressSequentially("Keep every word in your own pod.");
  await expect(page).toHaveURL(/\/docs\/d\//);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to your pod · just now" }),
  ).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(body).toContainText("A clear plan for the launch.");
  await expect(body).toContainText("Keep every word in your own pod.");
  await expect(title).toHaveValue("Launch plan");
  // Click the paragraph itself: the editor reads a keyboard-moved caret from the
  // asynchronous selectionchange event, which can land after the toolbar acts.
  await body.getByText("A clear plan for the launch.", { exact: true }).click();
  await page.getByRole("combobox", { name: "Block type", exact: true }).selectOption("h1");
  await expect(body.locator("h1")).toHaveText("A clear plan for the launch.");
  // TipTap returns focus on the next animation frame; a key pressed before it lands
  // would be undone when the editor re-applies its stored selection.
  await expect(body).toBeFocused();
  await settle(page);
  await body.press("Control+End");
  await settle(page);
  await body.press("Enter");
  await format(page, "Checklist");
  await expect(body).toBeFocused();
  await settle(page);
  await body.pressSequentially("Prepare the release");
  await expect(
    body.getByRole("checkbox", { name: "Prepare the release", exact: true }),
  ).toBeVisible();
  await body.press("Enter");
  await body.press("Enter");
  await body.pressSequentially("/");
  await page.getByRole("combobox", { name: "Insert a block" }).fill("tab");
  await page.getByRole("combobox", { name: "Insert a block" }).press("Enter");
  await expect(body.locator("table")).toBeVisible();
  await expect(body.locator("table tr")).toHaveCount(3);
  await expect(body.locator("table th")).toHaveCount(3);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to your pod · just now" }),
  ).toBeVisible({ timeout: 15_000 });
  await body.press("Escape");
  await expect(title).toBeFocused();
  await title.press("Escape");
  await expect(page.getByRole("link", { name: "Back to documents" })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await audit(page);
  await page.screenshot({ path: `e2e/screenshots/docs-editor-${suffix}.png`, fullPage: true });
  await page.getByRole("link", { name: "Back to documents" }).click();
  await expect(page.getByRole("link", { name: "Launch plan", exact: true })).toBeVisible();
  await audit(page);
  await page.screenshot({ path: `e2e/screenshots/docs-list-${suffix}.png`, fullPage: true });
  await page.getByRole("button", { name: "Actions for Launch plan", exact: true }).click();
  await page.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
  const deleting = page.getByRole("alertdialog", { name: "Move this document to trash?" });
  await deleting.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(page.getByText("Moved to trash", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Launch plan", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("link", { name: "Launch plan", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

// Keep the Next shell reachable across reloads while the injected pod transport is offline.
// The demo pod fetch rejects whenever navigator.onLine is false, just like real pod fetch.
async function demoOffline(page: Page, offline: boolean) {
  await page.evaluate((value) => {
    sessionStorage.setItem("docs-test-offline", value ? "1" : "0");
    dispatchEvent(new Event(value ? "offline" : "online"));
  }, offline);
}
async function podDocument(page: Page) {
  return page.evaluate(async () => {
    const snapshot = await new Promise<{
      resources: [string, { body: Uint8Array }][];
    }>((resolve, reject) => {
      const open = indexedDB.open("solid-suite-demo", 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction("pods").objectStore("pods").get("https://alice.demo.pod/");
        read.onsuccess = () => {
          // The demo pod stores { revision, snapshot }; older saves held the bare snapshot.
          resolve(read.result.snapshot ?? read.result);
          db.close();
        };
        read.onerror = () => {
          reject(read.error);
          db.close();
        };
      };
    });
    const entry = snapshot.resources.find(([url]) => url.endsWith("/docs/offline-notes.ttl"));
    const url = entry?.[0] ?? "";
    return {
      body: entry ? new TextDecoder().decode(entry[1].body) : "",
      updates: snapshot.resources.filter(([child]) =>
        child.startsWith(`${url.slice(0, -4)}/updates/`),
      ).length,
    };
  });
}
test("find replaces atomically and recovers failed offline writes across an offline reload", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => sessionStorage.getItem("docs-test-offline") !== "1",
    });
  });
  const body = await newDocument(page, "Offline notes");
  await body.pressSequentially("cat cat cat");
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to your pod · just now" }),
  ).toBeVisible({ timeout: 15_000 });
  await body.press("Control+f");
  await page.getByRole("textbox", { name: "Find", exact: true }).fill("cat");
  await expect(page.getByText("1 of 3", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Replace", exact: true }).fill("dog");
  await page.getByRole("button", { name: "Replace all", exact: true }).click();
  await expect(body).toContainText("dog dog dog");
  await page.getByRole("textbox", { name: "Find", exact: true }).press("Escape");
  await expect(body).toBeFocused();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to your pod · just now" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await podDocument(page)).body).toContain("dog dog dog");
  const before = await podDocument(page);
  await demoOffline(page, true);
  await body.press("Control+End");
  await body.pressSequentially(" safely offline");
  await expect(
    page.getByRole("status").filter({ hasText: "Offline — saved on this device" }),
  ).toBeVisible();
  const stillRemote = await podDocument(page);
  expect(stillRemote.body).not.toContain("safely offline");
  expect(stillRemote.updates).toBe(before.updates);
  await page.reload();
  await expect(body).toContainText("dog dog dog safely offline");
  await expect(page.getByText("Offline copy — your edits are saved on this device.")).toBeVisible();
  await demoOffline(page, false);
  await expect(
    page.getByRole("status").filter({ hasText: "Saved to your pod · just now" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(async () => (await podDocument(page)).body)
    .toContain("dog dog dog safely offline");
  await expect.poll(async () => (await podDocument(page)).updates).toBeGreaterThan(before.updates);
  await page.reload();
  await expect(body).toContainText("dog dog dog safely offline");
});
