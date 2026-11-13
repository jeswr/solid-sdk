// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { seedDemoSession } from "../demo-session";

test.use({ locale: "en" });
test.beforeEach(async ({ page }) => {
  await seedDemoSession(page);
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

async function settled(page: Page) {
  await expect(page.getByRole("status", { name: "Loading your music", exact: true })).toBeHidden({
    timeout: 30000,
  });
  await expect(page.getByRole("status", { name: "Retrying your music", exact: true })).toBeHidden();
}
async function seeded(page: Page) {
  await page.goto("/music/tracks");
  await page.waitForFunction(() => !!window.__suiteDemoPod);
  await expect(page.getByRole("heading", { level: 1, name: "Tracks", exact: true })).toBeVisible();
  await settled(page);
  await expect(
    page.getByRole("button", { name: "Like Amber Sky", exact: true }).filter({ visible: true }),
  ).toBeVisible();
}
async function accessible(page: Page) {
  await expect(page).toHaveTitle(/Music · Solid Suite/);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  // A modal dialog makes the page behind it inert, so only check the page heading without one.
  if ((await page.getByRole("dialog").count()) === 0)
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1),
  ).toBe(true);
}
async function emptyMusic(page: Page) {
  await seeded(page);
  await page.evaluate(async () => {
    const pod = window.__suiteDemoPod;
    if (!pod) throw new Error("Missing demo pod fixture");
    const base = new URL("music/", pod.root).href;
    const connector = new URL("integrations/spotify/music/", pod.root).href;
    const belongs = (url: string) => url.startsWith(base) || url.startsWith(connector);
    for (const [url] of pod.snapshot().resources.filter(([url]) => belongs(url))) {
      const response = await pod.fetch(url, { method: "DELETE" });
      if (!response.ok) throw new Error(`Could not clear ${url}`);
    }
    const containers = pod
      .snapshot()
      .containers.map(([url]) => url)
      .filter((url) => belongs(url) && url !== base)
      .sort((a, b) => b.length - a.length);
    for (const url of containers) {
      const response = await pod.fetch(url, { method: "DELETE" });
      if (!response.ok) throw new Error(`Could not clear ${url}`);
    }
    // An existing empty root represents a user's library and prevents demo re-seeding.
  });
  await page.reload();
  await settled(page);
}

const empties = [
  ["/music", "Your music", "No music yet", "Add music files"],
  ["/music/tracks", "Tracks", "No tracks yet", "Add music files"],
  ["/music/albums", "Albums", "No albums yet", "Add music files"],
  ["/music/artists", "Artists", "No artists yet", "Add music files"],
  ["/music/liked", "Liked songs", "No liked songs yet", "Add music files"],
  ["/music/search", "Search", "No music to search yet", "Add music files"],
  ["/music/playlists", "Playlists", "No playlists yet", "New playlist"],
  ["/music/history", "History", "No listening history yet", "Import history"],
  ["/music/import", "Import listening history", "No listening history yet", "Choose export files"],
] as const;
for (const [path, title, heading, action] of empties) {
  test(`${path} has an accessible first-run state and a working primary action`, async ({
    page,
  }) => {
    await emptyMusic(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
    await settled(page);
    const state = page
      .getByRole("status")
      .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
    await expect(state).toBeVisible();
    const primary =
      action === "Choose export files"
        ? state.getByLabel(action, { exact: true })
        : state.getByRole(action === "Import history" ? "link" : "button", {
            name: action,
            exact: true,
          });
    await expect(primary).toBeEnabled();
    await primary.focus();
    await expect(primary).toBeFocused();
    await accessible(page);
    if (action === "Add music files" || action === "New playlist") {
      await primary.press("Enter");
      await expect(page.getByRole("dialog", { name: action, exact: true })).toBeVisible();
      await accessible(page);
    } else if (action === "Import history") {
      await primary.press("Enter");
      await expect(
        page.getByRole("heading", { level: 1, name: "Import listening history", exact: true }),
      ).toBeVisible();
      await settled(page);
      await accessible(page);
    }
  });
}

async function breakDocument(page: Page, path: string) {
  return page.evaluate(async (path) => {
    const pod = window.__suiteDemoPod;
    if (!pod) throw new Error("Missing demo pod fixture");
    const url = new URL(path, pod.root).href;
    const original = await pod.fetch(url);
    if (!original.ok) throw new Error("Missing music fixture document");
    const body = await original.text();
    const result = await pod.fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": "text/turtle",
        "If-Match": original.headers.get("etag") as string,
      },
      body: "Deliberately invalid Turtle {{{",
    });
    if (!result.ok) throw new Error("Could not corrupt music fixture");
    return { url, body };
  }, path);
}
async function repairAndRetry(page: Page, document: { url: string; body: string }) {
  // Repair and activate the located Retry in the same task, before change notifications
  // can win the race. Recovery still goes through the real button and pod reader.
  await page.getByRole("button", { name: "Retry", exact: true }).evaluate(async (button, saved) => {
    const pod = window.__suiteDemoPod;
    if (!pod) throw new Error("Missing demo pod fixture");
    const current = await pod.fetch(saved.url);
    const response = await pod.fetch(saved.url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle", "If-Match": current.headers.get("etag") as string },
      body: saved.body,
    });
    if (!response.ok) throw new Error("Could not repair music fixture");
    (button as HTMLButtonElement).click();
  }, document);
  await settled(page);
}

test("a required track document fails visibly and Retry reads the repaired document", async ({
  page,
}) => {
  await seeded(page);
  const saved = await breakDocument(page, "music/tracks/catalog.ttl");
  await page.reload();
  await settled(page);
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toContainText("Couldn’t read your music library");
  await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No tracks yet", exact: true })).toHaveCount(0);
  await accessible(page);
  await repairAndRetry(page, saved);
  await expect(page.locator('[role="alert"]:not(#__next-route-announcer__)')).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Like Amber Sky", exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Tracks", exact: true })).toBeFocused();
  await accessible(page);
});

test("a broken playlist leaves the other playlist visible, with dismiss and Retry", async ({
  page,
}) => {
  await seeded(page);
  const saved = await breakDocument(page, "music/playlists/slow-mornings.ttl");
  await page.goto("/music/playlists");
  await settled(page);
  const notice = page.getByRole("alert", { name: "Some music couldn’t be read", exact: true });
  await expect(notice).toContainText("1 item couldn’t be read");
  await expect(
    page
      .getByRole("list", { name: "Playlists", exact: true })
      .getByRole("link")
      .filter({ hasText: "After hours" }),
  ).toBeVisible();
  await accessible(page);
  await notice.getByRole("button", { name: "Dismiss music notice", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: "Playlists", exact: true }),
  ).toBeFocused();
  await accessible(page);
  await page.reload();
  await settled(page);
  await expect(notice).toBeVisible();
  await repairAndRetry(page, saved);
  await expect(notice).toHaveCount(0);
  await expect(
    page
      .getByRole("list", { name: "Playlists", exact: true })
      .getByRole("link")
      .filter({ hasText: "Slow mornings" }),
  ).toBeVisible();
  await accessible(page);
});

test("a broken month keeps the rest of listening history visible", async ({ page }) => {
  await seeded(page);
  const path = await page.evaluate(() => {
    const pod = window.__suiteDemoPod;
    if (!pod) throw new Error("Missing demo pod fixture");
    const prefix = new URL("music/history/", pod.root).href;
    const months = pod
      .snapshot()
      .resources.map(([url]) => url)
      .filter((url) => url.startsWith(prefix))
      .sort()
      .reverse();
    if (months.length < 2) throw new Error("Expected multiple seeded months");
    return months[0] as string;
  });
  const saved = await breakDocument(page, path);
  await page.goto("/music/history");
  await settled(page);
  const notice = page.getByRole("alert", { name: "Some music couldn’t be read", exact: true });
  await expect(notice).toContainText("1 item couldn’t be read");
  await expect(
    page.getByRole("heading", { name: "No listening history yet", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Sol Anara", exact: true }).filter({ visible: true }).first(),
  ).toBeVisible();
  await accessible(page);
  await repairAndRetry(page, saved);
  await expect(notice).toHaveCount(0);
  await accessible(page);
});

test("search results are distinct from the first-run empty state", async ({ page }) => {
  await seeded(page);
  await page.goto("/music/search?q=NothingMatchesThisSong");
  await settled(page);
  await expect(
    page.getByRole("heading", { name: "No results for 'NothingMatchesThisSong'", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse all tracks", exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "No music to search yet", exact: true }),
  ).toHaveCount(0);
  await accessible(page);
});
