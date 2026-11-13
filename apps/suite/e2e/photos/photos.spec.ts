// AUTHORED-BY Codex GPT-6
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";
import { scenes } from "../../src/apps/photos/demo/images";
import { seedDemoSession } from "../demo-session";

// AUTHORED-BY Codex GPT-6.1-Sol
/** One existing WebP's VP8 keyframe muxed into a two-second WebM; no binary fixture or codec dependency. */
function tinyVideo(): Buffer {
  const element = (id: number[], payload: Buffer) => {
    let width = 1;
    while (payload.length >= 2 ** (7 * width) - 1) width++;
    const size = Buffer.alloc(width);
    let remaining = payload.length;
    for (let index = width - 1; index >= 0; index--) {
      size[index] = remaining & 255;
      remaining = Math.floor(remaining / 256);
    }
    size[0] = (size[0] ?? 0) | (1 << (8 - width));
    return Buffer.concat([Buffer.from(id), size, payload]);
  };
  const uint = (id: number[], value: number) => {
    const bytes = Buffer.alloc(value > 255 ? 4 : 1);
    bytes.writeUIntBE(value, 0, bytes.length);
    return element(id, bytes);
  };
  const string = (id: number[], value: string) => element(id, Buffer.from(value));
  const webp = Buffer.from(scenes[0][1], "base64");
  expect(webp.toString("ascii", 12, 16)).toBe("VP8 ");
  const frame = webp.subarray(20, 20 + webp.readUInt32LE(16));
  const header = element(
    [0x1a, 0x45, 0xdf, 0xa3],
    Buffer.concat([
      uint([0x42, 0x86], 1),
      uint([0x42, 0xf7], 1),
      uint([0x42, 0xf2], 4),
      uint([0x42, 0xf3], 8),
      string([0x42, 0x82], "webm"),
      uint([0x42, 0x87], 2),
      uint([0x42, 0x85], 2),
    ]),
  );
  const duration = Buffer.alloc(8);
  duration.writeDoubleBE(2000);
  const info = element(
    [0x15, 0x49, 0xa9, 0x66],
    Buffer.concat([
      uint([0x2a, 0xd7, 0xb1], 1000000),
      element([0x44, 0x89], duration),
      string([0x4d, 0x80], "Solid Suite"),
      string([0x57, 0x41], "Solid Suite"),
    ]),
  );
  const tracks = element(
    [0x16, 0x54, 0xae, 0x6b],
    element(
      [0xae],
      Buffer.concat([
        uint([0xd7], 1),
        uint([0x73, 0xc5], 1),
        uint([0x83], 1),
        string([0x86], "V_VP8"),
        element([0xe0], Buffer.concat([uint([0xb0], 160), uint([0xba], 100)])),
      ]),
    ),
  );
  const cluster = element(
    [0x1f, 0x43, 0xb6, 0x75],
    Buffer.concat([
      uint([0xe7], 0),
      element([0xa3], Buffer.concat([Buffer.from([0x81, 0, 0, 0x80]), frame])),
      element([0xa3], Buffer.concat([Buffer.from([0x81, 3, 232, 0x80]), frame])),
    ]),
  );
  return Buffer.concat([
    header,
    element([0x18, 0x53, 0x80, 0x67], Buffer.concat([info, tracks, cluster])),
  ]);
}

test.use({ locale: "en" });
test.beforeEach(async ({ page }) => {
  // Real app routes sit behind the shell session guard; remember the demo account.
  await seedDemoSession(page);
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

// AUTHORED-BY Codex GPT-6.1-Sol
test("uploads and plays a video, keeps it in collections and offers an unplayable demo original for download", async ({
  page,
}, info) => {
  await page.goto("/photos");
  await expect(opens(page)).toHaveCount(13);
  const demo = page.getByRole("link", { name: "Open Lake breeze, video, 1:02", exact: true });
  await expect(demo.locator(".pho-video-badge")).toHaveText("1:02");
  await demo.click();
  let viewer = page.getByRole("dialog", { name: "Lake breeze", exact: true });
  // The demo original is placeholder bytes, so the browser reports a decode error: the viewer
  // offers the file for download instead of a retry that would fetch it again.
  await expect(viewer.getByText("This video format can't be played in this browser")).toBeVisible();
  await expect(viewer.getByRole("link", { name: "Download video", exact: true })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Zoom in", exact: true })).toHaveCount(0);
  await capture(page, info, "video-unavailable");
  await viewer.getByRole("button", { name: "Close photo", exact: true }).click();
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page
    .getByRole("menuitemcheckbox", { name: "Remove location from uploads", exact: true })
    .click();
  await page.keyboard.press("Escape");
  await page.getByLabel("Upload photos and videos", { exact: true }).setInputFiles({
    name: "Lake clip.webm",
    mimeType: "video/webm",
    buffer: tinyVideo(),
  });
  const tile = page.getByRole("link", { name: "Open Lake clip.webm, video, 0:02", exact: true });
  await expect(tile).toBeVisible();
  await expect(tile.locator(".pho-video-badge")).toHaveText("0:02");
  await saved(page);
  await page.getByRole("button", { name: "Dismiss uploads", exact: true }).click();
  await tile.focus();
  await page.keyboard.press("Enter");
  viewer = page.getByRole("dialog", { name: "Lake clip.webm", exact: true });
  const video = viewer.locator("video");
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).toHaveAttribute("playsinline", "");
  await expect(video).toHaveAttribute("poster", /^blob:/);
  await expect
    .poll(() => video.evaluate((node: HTMLVideoElement) => node.readyState))
    .toBeGreaterThanOrEqual(2);
  await video.evaluate((node: HTMLVideoElement) => node.play());
  await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(false);
  await viewer.getByRole("button", { name: "Show information", exact: true }).click();
  await expect(viewer.getByText("Duration", { exact: true })).toBeVisible();
  await expect(viewer.getByText("0:02", { exact: true })).toBeVisible();
  await expect(viewer.getByText("160 × 100 px", { exact: true })).toBeVisible();
  await viewer.getByRole("button", { name: "Favourite", exact: true }).click();
  await saved(page);
  await capture(page, info, "video-playback");
  await viewer.getByRole("button", { name: "Close photo", exact: true }).click();
  await navigate(page, "Favourites");
  await expect(
    page.getByRole("link", { name: "Open Lake clip.webm, video, 0:02", exact: true }),
  ).toBeVisible();
  await navigate(page, "Storage");
  await expect(
    page.getByRole("link", { name: "Open Lake clip.webm, video, 0:02", exact: true }),
  ).toBeVisible();
  await page.goto("/photos/search?q=video");
  await expect(opens(page)).toHaveCount(2);
  await capture(page, info, "video-search");
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
  await expect(opens(page)).toHaveCount(13);
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
  await page.getByLabel("Upload photos and videos", { exact: true }).setInputFiles(
    [1, 2, 3].map((n) => ({
      name: `Upload ${n}.png`,
      mimeType: "image/png",
      buffer: Buffer.from((scenes[n % scenes.length] ?? scenes[0])[0], "base64"),
    })),
  );
  await expect(opens(page)).toHaveCount(16);
  await saved(page);
  await page.getByRole("button", { name: "Dismiss uploads", exact: true }).click();
  const today = page.getByRole("region", { name: "Today", exact: true });
  await expect(today.getByRole("link", { name: /^Open Upload/ })).toHaveCount(3);
  await capture(page, info, "timeline");
  await page.keyboard.press("Tab");
  await page.getByRole("link", { name: "Open Upload 3.png", exact: true }).focus();
  // The tile clips outward outlines; the keyboard ring must stay inside its image.
  await expect(page.getByRole("link", { name: "Open Upload 3.png", exact: true })).toHaveCSS(
    "outline-offset",
    "-4px",
  );
  await expect(page.getByRole("link", { name: "Open Upload 3.png", exact: true })).toHaveCSS(
    "outline-style",
    "solid",
  );
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
    page.getByText("Photos and videos in Trash stay in your pod until you delete them forever.", {
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
    await expect(opens(page)).toHaveCount(13);
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
  await expect(opens(page)).toHaveCount(13);
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
  await expect(opens(page)).toHaveCount(13);
});

// AUTHORED-BY Claude Opus 5.5
test("storage lists the largest photos and moving one to trash moves its space", async ({
  page,
}, info) => {
  await page.goto("/photos");
  await expect(opens(page)).toHaveCount(13);
  await navigate(page, "Storage");
  const largest = page.getByRole("region", { name: "Largest photos and videos", exact: true });
  const rows = largest.getByRole("listitem");
  await expect(rows).toHaveCount(13);
  const summary = page.getByRole("region", { name: "Storage summary", exact: true });
  await expect(summary.getByText(/· 13 items$/)).toBeVisible();
  await expect(summary.getByText(/· 0 items$/)).toBeVisible();
  await expect(page.getByText(/Couldn't measure/)).toHaveCount(0);
  const sizes = await largest.locator(".pho-storage-size").allTextContents();
  const bytes = (text: string) => {
    const [value = "0", unit = "B"] = text.split(/\s+/);
    return Number(value) * ({ B: 1, KB: 1e3, MB: 1e6 }[unit] ?? 1);
  };
  expect(sizes.every((size) => bytes(size) > 0)).toBe(true);
  expect(sizes.map(bytes)).toEqual([...sizes.map(bytes)].sort((a, b) => b - a));
  await capture(page, info, "storage");
  const first = rows.first();
  const name = (await first.locator(".pho-storage-name > span").first().textContent()) ?? "";
  const secondName =
    (await rows.nth(1).locator(".pho-storage-name > span").first().textContent()) ?? "";
  await first.getByRole("button", { name: `Move ${name} to trash`, exact: true }).focus();
  await page.keyboard.press("Enter");
  await saved(page);
  await expect(rows).toHaveCount(12);
  // Keyboard focus stays in the list on the row that took the trashed row's place.
  await expect(
    page.getByRole("button", { name: `Move ${secondName} to trash`, exact: true }),
  ).toBeFocused();
  await expect(summary.getByText(/· 1 item · Review trash$/)).toBeVisible();
  await summary.getByRole("link", { name: "Review trash", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Trash", exact: true })).toBeVisible();
  await expect(opens(page)).toHaveCount(1);
});

test("storage still shows trash space when every photo is in the trash", async ({ page }) => {
  await page.goto("/photos");
  await expect(opens(page)).toHaveCount(13);
  await navigate(page, "Storage");
  const rows = page
    .getByRole("region", { name: "Largest photos and videos", exact: true })
    .getByRole("listitem");
  for (let left = 13; left > 0; left--) {
    await expect(rows).toHaveCount(left);
    await rows
      .first()
      .getByRole("button", { name: /^Move .* to trash$/ })
      .click();
    await saved(page);
  }
  await expect(
    page.getByText("No photos or videos in your pod yet", { exact: true }),
  ).toBeVisible();
  const summary = page.getByRole("region", { name: "Storage summary", exact: true });
  await expect(summary.getByText(/· 13 items · Review trash$/)).toBeVisible();
  await page.reload();
  await expect(summary.getByText(/· 13 items · Review trash$/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Storage", exact: true })).toBeVisible();
});

// AUTHORED-BY Claude Opus 5.5
test("imports a Google Takeout folder with sidecar dates and album folders", async ({
  page,
}, info) => {
  test.setTimeout(120_000);
  const root = info.outputPath("Google Photos");
  const png = (n: number) => Buffer.from((scenes[n] ?? scenes[0])[0], "base64");
  const sidecar = (title: string, description: string) =>
    JSON.stringify({
      title,
      description,
      photoTakenTime: { timestamp: "1556704800" },
      geoData: { latitude: 38.72, longitude: -9.14 },
    });
  const files: [string, string | Buffer][] = [
    ["Photos from 2019/Beach.png", png(1)],
    ["Photos from 2019/Beach.png.json", sidecar("Beach.png", "Beach day")],
    ["Photos from 2019/clip.mp4", "not really a video"],
    ["Lisbon/Beach.png", png(1)],
    ["Lisbon/Tram.png", png(2)],
    ["Lisbon/Tram.png.supplemental-metadata.json", sidecar("Tram.png", "")],
    ["Lisbon/metadata.json", JSON.stringify({ title: "Lisbon" })],
    ["Trash/Deleted.png", png(3)],
    // Location can't be removed from HEIC in the browser, so it is reported, not retried.
    ["Photos from 2019/IMG_9.HEIC", "not really a HEIC"],
  ];
  for (const [path, body] of files) {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(resolve(root, path), body);
  }
  await page.goto("/photos");
  await expect(opens(page)).toHaveCount(13);
  await page.getByRole("button", { name: "Upload", exact: true }).click();
  await page.getByRole("menuitem", { name: "Import from Google Takeout", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Import from Google Takeout", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", {
      name: "Remove location from imported photos and videos",
      exact: true,
    }),
  ).toBeChecked();
  await page
    .locator(".pho-takeout-pick")
    .getByLabel("Choose folder", { exact: true })
    .setInputFiles(root);
  const panel = page.locator(".pho-takeout-panel");
  await expect(panel.getByRole("heading", { name: "Ready to import" })).toBeFocused();
  for (const [label, value] of [
    ["Photos and videos", "4"],
    ["With dates, places or captions from Takeout", "2"],
    ["Albums", "1"],
  ] as const)
    await expect(
      panel.locator("div", { has: page.getByText(label, { exact: true }) }).locator("dd"),
    ).toHaveText(value);
  await expect(panel).toContainText(
    "1 copy of items that are also in an album will be imported once.",
  );
  await expect(panel).toContainText("1 video included in this import.");
  await expect(panel).toContainText("1 deleted item from the Google Photos bin will be left out.");
  await capture(page, info, "takeout-preview");
  await page.getByRole("button", { name: "Import 4 items", exact: true }).click();
  await expect(panel.getByRole("heading", { name: "Import finished" })).toBeFocused({
    timeout: 60_000,
  });
  await expect(panel).toContainText("Imported 2 items into 1 album.");
  await panel.getByText("2 items couldn't be imported", { exact: true }).click();
  await expect(panel).toContainText("IMG_9.HEIC: Location can't be removed from this format here.");
  await expect(panel.getByRole("button", { name: /^Retry/ })).toHaveCount(0);
  await capture(page, info, "takeout-done");
  await page.getByRole("link", { name: "View photos and videos", exact: true }).click();
  await expect(opens(page)).toHaveCount(15);
  await expect(page.getByRole("link", { name: "Open Beach.png", exact: true })).toBeVisible();
  await navigate(page, "Albums");
  await page.getByRole("link", { name: /Lisbon/ }).click();
  await expect(opens(page)).toHaveCount(2);
});
