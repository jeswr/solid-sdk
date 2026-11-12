// AUTHORED-BY Codex (GPT-6.1 Sol)
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { seedDemoSession } from "./demo-session";

test.use({ locale: "en-GB" });
test.beforeEach(async ({ page }) => {
  await seedDemoSession(page);
  await page.route("**/__bookmarks-test-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset demo</title>" }),
  );
  await page.goto("/__bookmarks-test-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo pod deletion blocked"));
    });
  });
  await page.unroute("**/__bookmarks-test-reset");
});
async function saved(page: Page) {
  await expect(page.locator(".bkm-save-status")).toHaveText("");
}
async function view(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.locator("#bkm-view").click();
    await page.getByRole("option", { name: new RegExp(`^${name}`) }).click();
  } else
    await page
      .getByRole("navigation", { name: "Bookmark views", exact: true })
      .getByRole("button", { name: new RegExp(`^${name}`) })
      .click();
}

test("demo CRUD, search, tags, bulk actions, HTML interchange and persistence", async ({
  page,
}) => {
  await page.goto("/bookmarks");
  await expect(page.locator(".bkm-item")).toHaveCount(6);
  await page.getByRole("button", { name: "Add bookmark", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Add a bookmark" });
  await editor.getByLabel("URL", { exact: true }).fill("HTTPS://EXAMPLE.org");
  await editor.getByLabel("Title", { exact: true }).focus();
  await expect(editor.getByLabel("Title", { exact: true })).toHaveValue("example.org");
  await editor.getByLabel("Title", { exact: true }).fill("The orchard notebook");
  await editor.getByLabel("Description", { exact: true }).fill("Ideas for a small orchard");
  await editor
    .getByLabel("Notes", { exact: true })
    .fill("Ask the fictional Bracken Bay garden club");
  await editor.getByLabel("Tags", { exact: true }).fill("garden, reading");
  await editor.getByRole("button", { name: "Save bookmark" }).click();
  const link = page.getByRole("link", { name: "The orchard notebook", exact: true });
  await expect(link).toBeVisible();
  await saved(page);
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("href", "https://example.org/");
  await page.getByRole("button", { name: "Edit The orchard notebook", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Notes", { exact: true })
    .fill("Remember the spring planting plan");
  await page.getByRole("button", { name: "Save bookmark" }).click();
  await saved(page);
  await page.getByRole("textbox", { name: "Search bookmarks" }).fill("remember spring");
  await expect(page.locator(".bkm-item")).toHaveCount(1);
  await page.getByRole("textbox", { name: "Search bookmarks" }).fill("");
  await page.getByRole("button", { name: "Archive The orchard notebook", exact: true }).click();
  await saved(page);
  await view(page, "Unread");
  await expect(link).toHaveCount(0);
  await view(page, "Archived");
  await expect(link).toBeVisible();
  await page.getByRole("button", { name: "Unarchive The orchard notebook", exact: true }).click();
  await saved(page);
  await view(page, "All bookmarks");
  await page.getByRole("checkbox", { name: "Select The orchard notebook", exact: true }).check();
  await expect(
    page.getByRole("checkbox", { name: "Select all visible bookmarks", exact: true }),
  ).toHaveAttribute("aria-checked", "mixed");
  await page.locator(".bkm-bulk").getByRole("button", { name: "Add tag", exact: true }).click();
  await page.getByLabel("Tag name").fill("weekend");
  await page.getByRole("dialog").getByRole("button", { name: "Add tag", exact: true }).click();
  await saved(page);
  await page.getByRole("button", { name: "Delete The orchard notebook", exact: true }).click();
  await expect(link).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await saved(page);
  await expect(link).toBeVisible();
  await page.getByRole("button", { name: "Card layout", exact: true }).click();
  await expect(page.locator(".bkm-collection")).toHaveClass(/bkm-cards/);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByLabel("Bookmarks HTML file").setInputFiles({
    name: "bookmarks.html",
    mimeType: "text/html",
    buffer: Buffer.from(
      '<DL><DT><H3>Imported folder</H3><DL><DT><A HREF="HTTPS://EXAMPLE.net/imported" ADD_DATE="1700000000" TAGS="reading">An imported idea</A></DL></DL>',
    ),
  });
  await expect(page.getByRole("dialog").getByRole("status")).toContainText("1 bookmark to import");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Import bookmarks", exact: true })
    .click();
  await saved(page);
  await expect(page.getByRole("link", { name: "An imported idea" })).toBeVisible();
  await expect(page.getByRole("link", { name: "An imported idea" })).toHaveAttribute(
    "href",
    "https://example.net/imported",
  );
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("bookmarks.html");
  await page.reload();
  await expect(link).toBeVisible();
  await expect(page.getByRole("link", { name: "An imported idea" })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
});

test("Undo remains available while its toast is hovered", async ({ page }) => {
  await page.goto("/bookmarks");
  await expect(page.locator(".bkm-item")).toHaveCount(6);
  await page.clock.install();
  await page
    .getByRole("button", { name: "Delete A small guide to quieter gardens", exact: true })
    .click();
  const undo = page.getByRole("button", { name: "Undo", exact: true });
  await undo.hover();
  await page.clock.fastForward(9000);
  await expect(undo).toBeVisible();
  await undo.click();
  await expect(
    page.getByRole("link", { name: "A small guide to quieter gardens", exact: true }),
  ).toBeVisible();
});

test("responsive light and dark views, empty search, keyboard controls and offline browsing", async ({
  page,
  context,
}) => {
  await page.goto("/bookmarks");
  await expect(page.locator(".bkm-item")).toHaveCount(6);
  for (const width of [375, 768, 1280])
    for (const dark of [false, true]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((dark) => document.documentElement.classList.toggle("dark", dark), dark);
      await page.getByRole("button", { name: "Card layout", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
      await page.getByRole("button", { name: "List layout", exact: true }).click();
    }
  await page.getByRole("textbox", { name: "Search bookmarks" }).fill("no such bookmark");
  await expect(page.getByText("Nothing here just yet")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters", exact: true }).click();
  await page.getByRole("button", { name: "Add bookmark", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await context.setOffline(true);
  await expect(page.locator(".bkm-notice")).toContainText("You're offline");
  await expect(page.getByRole("button", { name: "Add bookmark", exact: true })).toBeDisabled();
  await expect(page.locator(".bkm-item")).toHaveCount(6);
  await context.setOffline(false);
});
