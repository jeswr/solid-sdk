// AUTHORED-BY Codex (GPT-6.1 Sol)
import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { HILLS_PNG } from "../src/lib/demo-pod/binaries";
import { seedDemoSession } from "./demo-session";

test.use({ locale: "en-GB" });
test.beforeEach(async ({ page }) => {
  await seedDemoSession(page);
  await page.clock.setFixedTime(new Date("2026-11-11T12:00:00Z"));
  await page.route("**/__journal-reset", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reset journal demo</title>",
    }),
  );
  await page.goto("/__journal-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo database is still open"));
    });
  });
  await page.unroute("**/__journal-reset");
});
for (const width of [375, 768, 1280])
  for (const colour of ["light", "dark"] as const) {
    test(`write, revisit, edit, search and export privately at ${width}px in ${colour}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: colour });
      await page.goto("/journal");
      await expect(page.getByRole("heading", { name: "Your days, in your words" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^A little room to breathe$/ })).toBeVisible();
      await expect(page.getByRole("region", { name: "On this day" })).toContainText("A year ago");
      await page.getByRole("button", { name: "New entry", exact: true }).focus();
      await page.keyboard.press("Enter");
      const editor = page.getByRole("dialog", { name: "New entry", exact: true });
      await editor.getByLabel("Title (optional)").fill("A small win in Willowbridge");
      await editor
        .getByLabel("Your words")
        .fill("# Remember this\n\nI made **time** for a quiet walk.");
      await editor.getByRole("button", { name: "Great", exact: true }).click();
      await editor.getByLabel("Tags (separate with commas)").fill("gratitude, outdoors");
      await editor.getByLabel("Attach photos").setInputFiles({
        name: "a-small-moment.png",
        mimeType: "image/png",
        buffer: Buffer.from(HILLS_PNG),
      });
      await editor.getByRole("button", { name: "Preview", exact: true }).click();
      await expect(
        editor.getByRole("region", { name: "Markdown preview" }).locator("strong"),
      ).toHaveText("time");
      await expect(
        new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
          .then((result) => result.violations),
      ).resolves.toEqual([]);
      await editor.getByRole("button", { name: "Save entry", exact: true }).click();
      await expect(editor).toBeHidden();
      await expect(page.getByText("Saving your entry…", { exact: true })).toBeHidden();
      await page.reload();
      await page.getByLabel("Search your journal").fill("A small win in Willowbridge");
      await page.getByRole("button", { name: "A small win in Willowbridge", exact: true }).click();
      const reader = page.getByRole("dialog", { name: "A small win in Willowbridge" });
      await expect(reader).toContainText("quiet walk");
      await expect(reader.getByRole("img", { name: "Journal attachment 1" })).toBeVisible();
      await reader.getByRole("button", { name: "Edit entry", exact: true }).click();
      const edit = page.getByRole("dialog", { name: "Edit entry", exact: true });
      await edit.getByLabel("Your words").fill("A longer walk, and a cup of tea.");
      await edit.getByRole("button", { name: "Save entry", exact: true }).click();
      await expect(page.getByText("Saving your entry…", { exact: true })).toBeHidden();
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export Markdown", exact: true }).click();
      expect((await download).suggestedFilename()).toBe("my-journal.md");
      await page.getByLabel("Search your journal").fill("");
      await page.getByRole("button", { name: "Calendar", exact: true }).click();
      await expect(page.getByRole("region", { name: "Writing calendar" })).toBeVisible();
      await page.getByRole("button", { name: /11 November 2026:.*entr/ }).click();
      await expect(page.getByText("Entries for 2026-11-11", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Clear date filter" }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      expect(
        (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
          .violations,
      ).toEqual([]);
    });
  }
