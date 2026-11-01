// AUTHORED-BY Codex GPT-6.1-Sol
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { encodeRef } from "../../src/lib/refs";

const sample = fileURLToPath(new URL("../../public/samples/sample-mailbox.mbox", import.meta.url));
test.use({ locale: "en" });
test.beforeEach(async ({ page }) => {
  await page.route("**/__mail-test-reset", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reset demo pod</title>",
    }),
  );
  await page.goto("/__mail-test-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo pod database deletion blocked"));
    });
  });
  await page.unroute("**/__mail-test-reset");
});
async function capture(page: Page, info: TestInfo, view: string) {
  await page.evaluate(() => document.fonts.ready);
  const directory = fileURLToPath(
    new URL("../../../../artifacts/playwright/mail/", import.meta.url),
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({ path: `${directory}/${info.project.name}-${view}.png`, fullPage: true });
}
async function accessible(page: Page) {
  await expect(page).toHaveTitle("Mail · Solid Suite");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function nav(page: Page, folder: string) {
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Navigation", exact: true })
      .getByRole("link", { name: new RegExp(`^${folder}(?: \\d+ unread)?$`) })
      .click();
  } else
    await page
      .getByRole("navigation", { name: "Mail", exact: true })
      .getByRole("link", { name: new RegExp(`^${folder}(?: \\d+ unread)?$`) })
      .click();
  await expect(page.getByRole("heading", { name: folder, exact: true, level: 1 })).toBeVisible();
}
test("imports, reads with the keyboard, stars, archives and searches a mailbox", async ({
  page,
}, info) => {
  await page.goto("/mail/import");
  await expect(page.getByRole("heading", { name: "Import mail", exact: true })).toBeVisible();
  await accessible(page);
  await capture(page, info, "import");
  await page.getByLabel("Mailbox file", { exact: true }).setInputFiles(sample);
  await page.getByRole("button", { name: "Import mailbox", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Import complete", exact: true })).toBeVisible();
  await expect(
    page.getByText("18 messages imported · 2 attachments · 0 failed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Open Inbox", exact: true }).click();
  const rows = page.locator("tr[data-thread]");
  await expect(rows).toHaveCount(4);
  await accessible(page);
  await capture(page, info, "inbox");
  if ((page.viewportSize()?.width ?? 1280) < 1024)
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const compose = page
    .getByRole("button", { name: "Compose", exact: true })
    .filter({ visible: true });
  await expect(compose).toBeDisabled();
  await expect(compose).toHaveAccessibleDescription("Sending needs a connected mail account");
  if ((page.viewportSize()?.width ?? 1280) < 1024) await page.keyboard.press("Escape");
  const iri = await rows.first().getAttribute("data-thread");
  await rows.first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Garden plans 4", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Star thread", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unstar thread", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("status", { name: "Mail save status", exact: true })).toHaveText("");
  // Also verify the full thread deep link on the wide layout.
  if (!iri) throw new Error("The imported thread has no resource identifier");
  await page.goto(`/mail/t/${encodeRef(iri)}`);
  await expect(page.getByRole("heading", { name: "Garden plans 4", exact: true })).toBeVisible();
  await accessible(page);
  await capture(page, info, "thread");
  await nav(page, "Starred");
  await expect(page.locator("tr[data-thread]").filter({ hasText: "Garden plans 4" })).toBeVisible();
  const starred = page.locator("tr[data-thread]").filter({ hasText: "Garden plans 4" });
  await starred.focus();
  await page.keyboard.press("e");
  await nav(page, "Archive");
  await expect(page.locator("tr[data-thread]").filter({ hasText: "Garden plans 4" })).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search mail", exact: true })
    .fill('subject:"Garden plans 4"');
  await page.getByRole("searchbox", { name: "Search mail", exact: true }).press("Enter");
  await expect(page.locator("tr[data-thread]")).toHaveCount(1);
  await expect(page.locator("tr[data-thread]")).toContainText("Garden plans 4");
  await accessible(page);
  await capture(page, info, "search");
});
test("shows import ZIP guidance and query errors without losing navigation", async ({ page }) => {
  await page.goto("/mail/import");
  await page
    .getByLabel("Mailbox file", { exact: true })
    .setInputFiles({ name: "Takeout.zip", mimeType: "application/zip", buffer: Buffer.from("PK") });
  await expect(page.getByRole("alert")).toContainText(
    "Unzip your Takeout and choose the .mbox file inside",
  );
  await page.goto("/mail/search?q=unknown%3Aoperator");
  await expect(page.getByRole("alert")).toBeVisible();
  await page.goto("/mail/not-a-folder");
  await expect(page.getByRole("heading", { name: "This folder doesn't exist" })).toBeVisible();
});
