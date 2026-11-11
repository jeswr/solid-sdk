// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { encodeRef } from "../../src/lib/refs";
import { seedDemoSession } from "../demo-session";

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
  await seedDemoSession(page);
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
  await expect(rows).toHaveCount(11);
  await accessible(page);
  await capture(page, info, "inbox");
  await expect(rows.first()).toContainText("Noel Hart");
  await expect(rows.first().locator(".mail-row-copy")).toContainText(
    "Re: Saturday at the garden — The east gate",
  );
  // Both ellipsis lines and the date fit inside each row at every project width.
  expect(
    await rows.evaluateAll((elements) =>
      elements.every((row) => {
        const meta = row.querySelector(".mail-row-meta");
        const content = row.querySelector(".mail-row-content");
        const date = meta?.querySelector("time");
        const people = row.querySelector(".mail-row-people");
        const copy = row.querySelector(".mail-row-copy");
        if (!meta || !content || !date || !people || !copy) return false;
        return (
          date.scrollWidth <= meta.clientWidth &&
          meta.getBoundingClientRect().right < row.getBoundingClientRect().right &&
          content.getBoundingClientRect().right <= meta.getBoundingClientRect().left &&
          [people, copy].every((line) => getComputedStyle(line).textOverflow === "ellipsis")
        );
      }),
    ),
  ).toBe(true);
  // Inactive descendants cannot bypass the roving row focus.
  await rows.first().locator('input[type="checkbox"]').focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await expect(rows.first().locator("a")).toHaveAttribute("tabindex", "-1");
  await page.keyboard.press("ArrowUp");
  await expect(rows.first()).toBeFocused();
  if ((page.viewportSize()?.width ?? 1280) < 1024)
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const compose = page
    .getByRole("link", { name: "Compose", exact: true })
    .filter({ visible: true });
  await expect(compose).toHaveAttribute("href", "/mail/compose");
  await expect(compose).toHaveAccessibleDescription(
    "Drafts save to your pod. Sending needs a connected mail account.",
  );
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    // The drawer autofocuses its Close button, whose tooltip takes the first Escape.
    const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(drawer).toBeHidden({ timeout: 500 });
    }).toPass();
  }
  const iri = await rows.first().getAttribute("data-thread");
  await rows.first().focus();
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Saturday at the garden", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Saturday at the garden", exact: true }),
  ).toHaveJSProperty("tagName", (page.viewportSize()?.width ?? 1280) < 1024 ? "H1" : "H2");
  await page.getByRole("button", { name: "Star thread", exact: true }).click();
  await expect(page.getByRole("button", { name: "Unstar thread", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("status", { name: "Mail save status", exact: true })).toHaveText("");
  // A desktop selection URL remains visible when loaded on narrow layouts too.
  if (!iri) throw new Error("The imported thread has no resource identifier");
  await page.goto(`/mail/inbox?t=${encodeRef(iri)}`);
  await expect(
    page.getByRole("heading", { name: "Saturday at the garden", exact: true, level: 2 }),
  ).toBeVisible();
  await accessible(page);
  // Also verify the full thread deep link on the wide layout.
  if (!iri) throw new Error("The imported thread has no resource identifier");
  await page.goto(`/mail/t/${encodeRef(iri)}`);
  await expect(
    page.getByRole("heading", { name: "Saturday at the garden", exact: true }),
  ).toBeVisible();
  await accessible(page);
  expect(
    await page.locator(".mail-message-header time").evaluateAll(
      (dates) =>
        dates.length > 0 &&
        dates.every((date) => {
          const text = document.createRange();
          text.selectNodeContents(date);
          return text.getClientRects().length === 1;
        }),
    ),
  ).toBe(true);
  const sender = page.locator(".mail-message-person").last();
  await expect(sender.locator("strong")).toHaveText("Noel Hart");
  await expect(sender.locator(".mail-sender-address")).toHaveText("<noel@example.org>");
  await capture(page, info, "thread");
  await expect(page.getByRole("status", { name: "Mail save status", exact: true })).toHaveText("");
  await nav(page, "Starred");
  await expect(
    page.locator("tr[data-thread]").filter({ hasText: "Re: Saturday at the garden" }),
  ).toBeVisible();
  const starred = page.locator("tr[data-thread]").filter({ hasText: "Re: Saturday at the garden" });
  await starred.focus();
  await page.keyboard.press("e");
  await nav(page, "Archive");
  await expect(
    page.locator("tr[data-thread]").filter({ hasText: "Re: Saturday at the garden" }),
  ).toBeVisible();
  await page
    .getByRole("searchbox", { name: "Search mail", exact: true })
    .fill('subject:"Re: Saturday at the garden"');
  await page.getByRole("searchbox", { name: "Search mail", exact: true }).press("Enter");
  await expect(page.locator("tr[data-thread]")).toHaveCount(1);
  await expect(page.locator("tr[data-thread]")).toContainText("Re: Saturday at the garden");
  await accessible(page);
  await capture(page, info, "search");
});
test("shows import ZIP guidance and query errors without losing navigation", async ({
  page,
}, info) => {
  await page.goto("/mail/inbox");
  await expect(page.getByRole("heading", { name: "No mail yet", level: 2 })).toBeVisible();
  await accessible(page);
  await capture(page, info, "empty");
  await page.goto("/mail/import");
  await page
    .getByLabel("Mailbox file", { exact: true })
    .setInputFiles({ name: "Takeout.zip", mimeType: "application/zip", buffer: Buffer.from("PK") });
  await expect(
    page.getByRole("form", { name: "Mailbox import", exact: true }).getByRole("alert"),
  ).toContainText("Unzip your Takeout and choose the .mbox file inside");
  await page.goto("/mail/search?q=unknown%3Aoperator");
  await expect(page.locator(".mail-query-error")).toBeVisible();
  await page.goto("/mail/not-a-folder");
  await expect(page.getByRole("heading", { name: "This folder doesn't exist" })).toBeVisible();
});
test("composes, saves, edits and discards a draft in the pod", async ({ page }, info) => {
  await page.goto("/mail/compose");
  await expect(page.getByRole("heading", { name: "New message", level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toBeDisabled();
  await page.getByLabel("To", { exact: true }).fill("Bob Example <bob@example.org>");
  await page.getByLabel("Subject", { exact: true }).fill("Allotment rota");
  await page.getByLabel("Message", { exact: true }).fill("Can you water on Thursday?");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Edit draft", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/\/mail\/compose\?draft=/);
  await accessible(page);
  await capture(page, info, "compose");
  await page.goto("/mail/drafts");
  await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible();
  await page
    .getByRole("link", { name: /Allotment rota/ })
    .first()
    .click();
  await expect(page.getByText("Draft, not sent.")).toBeVisible();
  await page.getByRole("link", { name: "Edit draft", exact: true }).click();
  await expect(page.getByLabel("To", { exact: true })).toHaveValue("bob@example.org");
  await expect(page.getByLabel("Message", { exact: true })).toHaveValue(
    "Can you water on Thursday?",
  );
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Drafts", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Allotment rota/ })).toHaveCount(0);
  await page.goto("/mail/compose?draft=not-a-ref");
  await expect(page.getByRole("heading", { name: "This draft isn't here any more" })).toBeVisible();
});
