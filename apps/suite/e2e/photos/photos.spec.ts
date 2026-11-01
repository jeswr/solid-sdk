// AUTHORED-BY Codex GPT-6
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { scenes } from "../../src/apps/photos/demo/images";

test.use({ locale: "en" });
test.beforeEach(async ({ page }) => {
  await page.route("**/__drive-test-reset", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reset demo pod</title>",
    }),
  );
  await page.goto("/__drive-test-reset");
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
  await page.unroute("**/__drive-test-reset");
});
async function capture(page: Page, info: TestInfo, screen: string) {
  await expect(page).toHaveTitle(/Photos/);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator(".pho-page [role=status][aria-busy=true]")).toHaveCount(0);
  const violations = (
    await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()
  ).violations;
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(
    await page
      .locator(".pho-page")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const directory = resolve("../../artifacts/screens/photos");
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: resolve(directory, `${info.project.name}-${screen}.png`),
    fullPage: true,
  });
}
async function navigate(page: Page, name: string) {
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Navigation", exact: true })
      .getByRole("link", { name: new RegExp(`^${name}`) })
      .click();
    await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).toBeHidden();
  } else
    await page
      .getByRole("navigation", { name: "Photos", exact: true })
      .getByRole("link", { name: new RegExp(`^${name}`) })
      .click();
  await expect(page.getByRole("heading", { level: 1, name, exact: true })).toBeVisible();
}
const opens = (page: Page) => page.locator(".pho-page a[data-photo-ref]");
async function saved(page: Page) {
  await expect(page.locator(".pho-save-status")).not.toHaveText("Saving…");
}

test("upload, keyboard lightbox, undo, albums, reorder, cover, favourites and trash persist", async ({
  page,
}, info) => {
  test.setTimeout(180_000);
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    if (/^https?:/.test(request.url()) && !request.url().startsWith("http://127.0.0.1:"))
      remoteRequests.push(request.url());
  });
  await page.goto("/photos");
  await expect(opens(page)).toHaveCount(12);
  const uploadButton = page.getByRole("button", { name: "Upload", exact: true });
  await expect(uploadButton).toHaveCount(1);
  await uploadButton.click();
  await expect(page.getByRole("menuitem", { name: "Upload files", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Upload folder", exact: true })).toBeVisible();
  await expect(
    page.getByRole("menuitemcheckbox", { name: "Remove location from uploads", exact: true }),
  ).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(uploadButton).toBeFocused();
  await page.getByLabel("Upload images", { exact: true }).setInputFiles(
    [1, 2, 3].map((n) => ({
      name: `Upload ${n}.png`,
      mimeType: "image/png",
      buffer: Buffer.from((scenes[n % scenes.length] ?? scenes[0])[0], "base64"),
    })),
  );
  await expect(opens(page)).toHaveCount(15);
  await saved(page);
  await page.getByRole("button", { name: "Dismiss uploads", exact: true }).click();
  const today = page.getByRole("region", { name: "Today", exact: true });
  await expect(today.getByRole("link", { name: /^Open Upload/ })).toHaveCount(3);
  await capture(page, info, "timeline");
  await page.getByRole("link", { name: "Open Upload 3.png", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Upload 3.png", exact: true })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  const lightbox = page.getByRole("dialog", { name: "Upload 2.png", exact: true });
  await expect(lightbox).toBeVisible();
  await lightbox.getByRole("button", { name: "Show information", exact: true }).click();
  await expect(lightbox.getByText("Date taken", { exact: true })).toBeVisible();
  await expect(lightbox.getByRole("img", { name: "Upload 2.png", exact: true })).toBeVisible();
  await lightbox.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(lightbox.getByRole("button", { name: "Reset zoom", exact: true })).toHaveText(
    "125%",
  );
  await lightbox.getByRole("button", { name: "Reset zoom", exact: true }).click();
  await capture(page, info, "lightbox");
  await lightbox.getByRole("button", { name: "Move to trash", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Photos", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open Upload 2.png", exact: true })).toBeVisible();
  await navigate(page, "Albums");
  await page.getByRole("button", { name: "New album", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New album", exact: true });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "New album", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "New album", exact: true }).click();
  await dialog.getByLabel("Album name", { exact: true }).fill("Weekend");
  await dialog.getByRole("button", { name: "Create album", exact: true }).click();
  await expect(dialog).toBeHidden();
  await saved(page);
  await capture(page, info, "albums");
  await page.getByRole("link", { name: "Weekend 0 photos", exact: true }).click();
  await page.getByRole("button", { name: "Add photos", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Add photos to Weekend", exact: true });
  await picker.getByRole("checkbox", { name: "Select Upload 1.png", exact: true }).check();
  await picker.getByRole("checkbox", { name: "Select Upload 2.png", exact: true }).check();
  await picker.getByRole("button", { name: "Add 2 photos", exact: true }).click();
  await expect(picker).toBeHidden();
  await saved(page);
  await expect(page.getByRole("button", { name: "Add photos", exact: true })).toBeFocused();
  await expect(opens(page)).toHaveCount(2);
  // Member order follows the explicit picker selection, independent of timeline dates.
  await expect(opens(page).first()).toHaveAttribute("data-photo-ref", /.+/);
  await page.getByRole("link", { name: "Open Upload 1.png", exact: true }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await saved(page);
  await expect(opens(page).first()).toHaveAttribute("aria-label", "Open Upload 2.png");
  await page.reload();
  await expect(opens(page).first()).toHaveAttribute("aria-label", "Open Upload 2.png");
  // Dropping the second member onto itself must leave the saved order unchanged.
  const self = page
    .locator(".pho-tile")
    .filter({ has: page.getByRole("link", { name: "Open Upload 1.png", exact: true }) });
  const transfer = await page.evaluateHandle(() => new DataTransfer());
  await self.dispatchEvent("dragstart", { dataTransfer: transfer });
  await self.dispatchEvent("drop", { dataTransfer: transfer });
  await self.dispatchEvent("dragend", { dataTransfer: transfer });
  await saved(page);
  await expect(opens(page).first()).toHaveAttribute("aria-label", "Open Upload 2.png");
  const chosenThumbnail = await page
    .getByRole("link", { name: "Open Upload 1.png", exact: true })
    .locator("img")
    .evaluate(async (image: HTMLImageElement) =>
      Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer())),
    );
  const albumUrl = page.url();
  await page.getByRole("button", { name: "Actions for Upload 1.png", exact: true }).click();
  await page.getByRole("menuitem", { name: "Set as cover", exact: true }).click();
  await saved(page);
  await capture(page, info, "album");
  await navigate(page, "Albums");
  await page.reload();
  const card = page.getByRole("link", { name: "Weekend 2 photos", exact: true });
  const coverImage = card.locator("img");
  await expect(coverImage).toHaveAttribute("alt", "");
  await expect(coverImage).toBeVisible();
  expect(
    await coverImage.evaluate(async (image: HTMLImageElement) =>
      Array.from(new Uint8Array(await (await fetch(image.src)).arrayBuffer())),
    ),
  ).toEqual(chosenThumbnail);
  await page.goto(albumUrl);
  await expect(opens(page)).toHaveCount(2);
  await page.getByRole("link", { name: "Open Upload 1.png", exact: true }).click();
  const favouriteBox = page.getByRole("dialog", { name: "Upload 1.png", exact: true });
  await favouriteBox.getByRole("button", { name: "Favourite", exact: true }).click();
  await saved(page);
  await favouriteBox.getByRole("button", { name: "Close photo", exact: true }).click();
  await expect(page.getByRole("link", { name: "Open Upload 1.png", exact: true })).toBeFocused();
  await navigate(page, "Favourites");
  await page.reload();
  await expect(page.getByRole("link", { name: "Open Upload 1.png", exact: true })).toBeVisible();
  await capture(page, info, "favourites");
  await page.getByRole("link", { name: "Open Upload 1.png", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Upload 1.png", exact: true })
    .getByRole("button", { name: "Move to trash", exact: true })
    .click();
  await navigate(page, "Trash");
  await page.reload();
  const trashCard = page.locator(".pho-tiles[data-actions=true] .pho-tile").first();
  await expect(trashCard).toBeVisible();
  for (const name of ["Restore", "Delete forever"]) {
    const button = trashCard.getByRole("button", { name, exact: true });
    await expect(button).toBeVisible();
    await expect(button).toBeInViewport({ ratio: 1 });
    // Visibility alone does not detect clipped controls inside overflow:hidden.
    expect(
      await button.evaluate((element) => {
        const card = element.closest(".pho-tile");
        if (!card) return false;
        const bounds = card.getBoundingClientRect();
        const rect = element.getBoundingClientRect();
        return (
          rect.top >= bounds.top &&
          rect.bottom <= bounds.bottom &&
          rect.left >= bounds.left &&
          rect.right <= bounds.right &&
          element.contains(
            document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2),
          )
        );
      }),
    ).toBe(true);
  }
  await expect(
    page.getByText("Photos in Trash stay in your pod until you delete them forever.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".pho-eyebrow")).toHaveCount(0);
  await capture(page, info, "trash");
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await saved(page);
  await expect(page.getByRole("heading", { name: "Trash is empty", exact: true })).toBeVisible();
  await navigate(page, "Favourites");
  await page.reload();
  await expect(page.getByRole("link", { name: "Open Upload 1.png", exact: true })).toBeVisible();
  expect(remoteRequests).toEqual([]);
});

test.describe("browser locale", () => {
  test.use({ locale: "en-GB" });
  test("formats day headings using the browser's locale", async ({ page }) => {
    await page.clock.setFixedTime(new Date("2026-11-01T12:00:00Z"));
    await page.goto("/photos");
    await expect(opens(page)).toHaveCount(12);
    const expected = await page.evaluate(() => {
      return new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date("2026-10-29T00:00:00Z"));
    });
    await expect(
      page.getByRole("heading", { level: 2, name: expected, exact: true }),
    ).toBeVisible();
  });
});

test("search, selection, direct lightbox reload and album deletion keep originals", async ({
  page,
}, info) => {
  await page.goto("/photos");
  await expect(opens(page)).toHaveCount(12);
  const search = page.getByRole("searchbox", { name: "Search in Photos", exact: true });
  const longName = "W".repeat(100);
  await search.fill(longName);
  await search.press("Enter");
  await expect(
    page.getByRole("heading", { level: 1, name: `Results for “${longName}”`, exact: true }),
  ).toBeVisible();
  await capture(page, info, "search-long-term");
  await search.fill("Ghent trip");
  await search.press("Enter");
  await expect(opens(page)).toHaveCount(3);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await opens(page).first().focus();
  await page.keyboard.press(" ");
  await expect(page.getByText("1 selected", { exact: true })).toBeVisible();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByText("2 selected", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("2 selected", { exact: true })).toBeHidden();
  await opens(page).first().press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close photo", exact: true }).click();
  await navigate(page, "Albums");
  await page.getByRole("link", { name: /Ghent trip/ }).click();
  await expect(page.getByLabel("Album title", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Share album", exact: true })).toBeDisabled();
  const rename = page.getByRole("button", { name: "Rename", exact: true });
  await rename.click();
  const renameDialog = page.getByRole("dialog", { name: "Rename album", exact: true });
  await expect(renameDialog.getByLabel("Album name", { exact: true })).toBeFocused();
  await renameDialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(rename).toBeFocused();
  await rename.click();
  await renameDialog.getByLabel("Album name", { exact: true }).fill(longName);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze())
      .violations,
  ).toEqual([]);
  await renameDialog.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(renameDialog).toBeHidden();
  await expect(rename).toBeFocused();
  await expect(page.getByRole("heading", { level: 1, name: longName, exact: true })).toBeVisible();
  await saved(page);
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: longName, exact: true })).toBeVisible();
  await capture(page, info, "album-long-name");
  await page.getByRole("button", { name: "Delete album", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Delete this album?", exact: true });
  await confirm.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("button", { name: "Delete album", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Delete album", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Delete this album?", exact: true })
    .getByRole("button", { name: "Delete album", exact: true })
    .click();
  await navigate(page, "Photos");
  await expect(opens(page)).toHaveCount(12);
});
