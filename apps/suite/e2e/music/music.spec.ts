// AUTHORED-BY Codex GPT-6
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, type TestInfo, test } from "@playwright/test";

test.use({ locale: "en" });
test.beforeEach(async ({ page }) => {
  await page.route("**/__music-test-reset", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reset demo pod</title>",
    }),
  );
  await page.goto("/__music-test-reset");
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
  await page.unroute("**/__music-test-reset");
});
async function ready(page: Page, path: string, title: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
  await expect(page.getByRole("status", { name: "Loading your music" })).toBeHidden({
    timeout: 30000,
  });
  await expect(page.locator(".mus-content .suite-error-state")).toHaveCount(0);
}
async function accessible(page: Page) {
  await expect(page).toHaveTitle(/Music · Solid Suite/);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
    "Music content must scroll inside the shell without increasing document height",
  ).toBe(true);
}
async function capture(page: Page, info: TestInfo, screen: string) {
  await accessible(page);
  await page.evaluate(() => document.fonts.ready);
  const dir = fileURLToPath(new URL("../../../../artifacts/screens/music/", import.meta.url));
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: `${dir}/${info.project.name}-${screen}.png`, fullPage: true });
}
function visibleLike(page: Page, name: string) {
  return page.getByRole("button", { name, exact: true }).filter({ visible: true });
}

test("home periods, library, likes, search, albums, artists and history", async ({
  page,
}, info) => {
  const remote: string[] = [];
  page.on("request", (request) => {
    if (request.resourceType() === "image" && !request.url().startsWith("http://127.0.0.1"))
      remote.push(request.url());
  });
  await ready(page, "/music", "Your music");
  await expect(
    page.getByRole("list", { name: "Recently played", exact: true }).getByRole("listitem"),
  ).not.toHaveCount(0);
  const recent = page.getByRole("list", { name: "Recently played", exact: true });
  const albums = await recent
    .getByRole("link")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")));
  expect(new Set(albums).size).toBe(albums.length);
  expect(albums.length).toBeGreaterThan(1);
  const tones = await recent
    .locator(".mus-artwork")
    .evaluateAll((tiles) => tiles.map((tile) => getComputedStyle(tile).backgroundColor));
  expect(new Set(tones).size).toBeGreaterThan(1);
  const leaders: string[] = [];
  for (const period of ["Today", "1W", "1M", "1Y"]) {
    await page.getByRole("button", { name: period, exact: true }).click();
    await expect(page.getByRole("button", { name: period, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    leaders.push(
      await page
        .getByRole("list", { name: "Your top artists", exact: true })
        .getByRole("listitem")
        .first()
        .getByRole("link")
        .innerText(),
    );
  }
  expect(new Set(leaders).size).toBe(4);
  await capture(page, info, "home");
  await ready(page, "/music/tracks", "Tracks");
  await expect(visibleLike(page, "Like Amber Sky")).toBeVisible();
  await capture(page, info, "tracks");
  await visibleLike(page, "Like Amber Sky").click();
  await expect(visibleLike(page, "Unlike Amber Sky")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".mus-save")).toBeHidden();
  await ready(page, "/music/liked", "Liked songs");
  await expect(visibleLike(page, "Unlike Amber Sky")).toBeVisible();
  await capture(page, info, "liked");
  const search = page.getByRole("searchbox", { name: "Search in Music" });
  await search.fill("Morning Glass");
  await search.press("Enter");
  await expect(page.getByRole("heading", { level: 1, name: "Search", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "1 song found" })).toBeVisible();
  await accessible(page);
  await ready(page, "/music/albums", "Albums");
  await capture(page, info, "albums");
  await page
    .getByRole("list", { name: "Albums", exact: true })
    .getByRole("link")
    .filter({ hasText: "Soft Horizons" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Soft Horizons", exact: true }),
  ).toBeVisible();
  await accessible(page);
  await ready(page, "/music/artists", "Artists");
  await accessible(page);
  await page
    .getByRole("list", { name: "Artists", exact: true })
    .getByRole("link")
    .filter({ hasText: "Mira & the Tides" })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Mira & the Tides", exact: true }),
  ).toBeVisible();
  await accessible(page);
  await ready(page, "/music/history", "History");
  await capture(page, info, "history");
  await page.getByRole("button", { name: "Load older history", exact: true }).click();
  await expect(page.getByRole("button", { name: "Load older history", exact: true })).toBeEnabled();
  expect(remote).toEqual([]);
});

test("create playlist, add three songs, reorder by keyboard and persist", async ({
  page,
}, info) => {
  await ready(page, "/music/playlists", "Playlists");
  await accessible(page);
  await page
    .locator(".mus-page-header")
    .getByRole("button", { name: "New playlist", exact: true })
    .click();
  const create = page.getByRole("dialog", { name: "New playlist", exact: true });
  await create.getByLabel("Name", { exact: true }).fill("Sunday study");
  await create.getByLabel("Description", { exact: true }).fill("A quiet afternoon collection.");
  await create.getByRole("button", { name: "Create playlist", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Sunday study", exact: true }),
  ).toBeVisible();
  await page
    .locator(".mus-playlist-toolbar")
    .getByRole("button", { name: "Add songs", exact: true })
    .click();
  const add = page.getByRole("dialog", { name: "Add songs", exact: true });
  for (const title of ["Morning Glass", "Blue Hour", "Wildflower"]) {
    await add.getByRole("searchbox", { name: "Find songs", exact: true }).fill(title);
    await add.getByRole("checkbox").check();
  }
  await add.getByRole("button", { name: "Add selected songs", exact: true }).click();
  const list = page.getByRole("list", { name: "Playlist songs", exact: true });
  await expect(list.getByRole("listitem")).toHaveCount(3);
  await expect(page.locator(".mus-save")).toBeHidden();
  const handle = page.getByRole("button", {
    name: "Reorder Morning Glass, position 1",
    exact: true,
  });
  await handle.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(list.locator(".mus-track-name strong")).toHaveText([
    "Blue Hour",
    "Morning Glass",
    "Wildflower",
  ]);
  await expect(
    page.getByRole("button", { name: "Reorder Morning Glass, position 2", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".mus-save")).toBeHidden();
  const url = page.url();
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Sunday study", exact: true }),
  ).toBeVisible();
  await expect(list.locator(".mus-track-name strong")).toHaveText([
    "Blue Hour",
    "Morning Glass",
    "Wildflower",
  ]);
  expect(page.url()).toBe(url);
  await capture(page, info, "playlist");
  await page.getByRole("button", { name: "More actions for Wildflower", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("menuitem", { name: "Move up", exact: true }).press("Enter");
  await expect(list.locator(".mus-track-name strong")).toHaveText([
    "Blue Hour",
    "Wildflower",
    "Morning Glass",
  ]);
  await expect(
    page.getByRole("button", { name: "Reorder Wildflower, position 2", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".mus-save")).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Reorder Wildflower, position 2", exact: true }),
  ).toBeFocused();
  await page.reload();
  await expect(list.locator(".mus-track-name strong")).toHaveText([
    "Blue Hour",
    "Wildflower",
    "Morning Glass",
  ]);
  await page.getByRole("button", { name: "Edit details", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Edit playlist details", exact: true });
  await details.getByRole("textbox", { name: "Name", exact: true }).fill("Sunday focus");
  await details
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("A focused afternoon.");
  await accessible(page);
  await details.getByRole("button", { name: "Save details", exact: true }).click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Sunday focus", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("A focused afternoon.", { exact: true })).toBeVisible();
  await expect(page.locator(".mus-content").getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit details", exact: true })).toBeFocused();
  await accessible(page);
  for (const [title, focus] of [
    ["Morning Glass", "Reorder Wildflower, position 2"],
    ["Blue Hour", "Reorder Wildflower, position 1"],
    ["Wildflower", "Add songs"],
  ] as const) {
    await page.getByRole("button", { name: `More actions for ${title}`, exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await page.getByRole("menuitem", { name: "Remove from playlist", exact: true }).press("Enter");
    const target =
      focus === "Add songs"
        ? page.locator(".mus-playlist-toolbar").getByRole("button", { name: focus, exact: true })
        : page.getByRole("button", { name: focus, exact: true });
    await expect(target).toBeFocused();
    await expect(page.locator(".mus-save")).toBeHidden();
    await expect(target).toBeFocused();
  }
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Find your playlist’s first song", exact: true }),
  ).toBeVisible();
  await accessible(page);
});

test("imports the offline Spotify fixture and finds its tracks", async ({ page }) => {
  await ready(page, "/music/tracks", "Tracks");
  await page.getByRole("button", { name: "Import Spotify sample", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Import Spotify sample", exact: true }),
  ).toBeEnabled();
  await page.getByRole("searchbox", { name: "Search in Music" }).fill("Blinding Lights");
  await page.getByRole("searchbox", { name: "Search in Music" }).press("Enter");
  await expect(
    page
      .locator(".mus-content")
      .getByText("Blinding Lights", { exact: true })
      .filter({ visible: true }),
  ).not.toHaveCount(0);
  await accessible(page);
});
