// AUTHORED-BY Codex GPT-6
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/__connect-test-reset", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Reset demo pod</title>",
    }),
  );
  await page.goto("/__connect-test-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo pod reset blocked"));
    });
  });
  await page.unroute("**/__connect-test-reset");
});

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page }).analyze();
  expect(
    result.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  expect(await page.getByRole("heading", { level: 1 }).count()).toBe(1);
  expect(await page.locator(".hm-connect").innerText()).not.toMatch(
    /https?:|\bRDF\b|\bcontainer\b|Type Index/,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function connection(page: Page, id: string) {
  return page.evaluate(
    (id) =>
      JSON.parse(localStorage.getItem("suite.connectors.v1") ?? "{}")[
        "https://alice.demo.pod/profile/card#me"
      ]?.[id],
    id,
  );
}

test("catalogue filters use the URL, search matches descriptions, n focuses search and cards fit the viewport", async ({
  page,
}, info) => {
  await page.goto("/connect?domain=media");
  await expect(page.getByRole("heading", { level: 1, name: "Connect services" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Media", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Spotify", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "GitHub", exact: true })).toHaveCount(0);
  await expect(page.getByText("Coming soon", { exact: true })).toHaveCount(0);
  await page.keyboard.press("n");
  const search = page.getByRole("searchbox", { name: "Search services" });
  await expect(search).toBeFocused();
  await search.fill("VIEWING HISTORY");
  await expect(page.locator(".hm-connect-card")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Netflix", exact: true })).toBeVisible();
  await search.fill("n");
  await expect(search).toHaveValue("n");
  await search.fill("");
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page).toHaveURL("/connect");
  const columns = await page
    .locator(".hm-connect-grid")
    .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(" ").length);
  expect(columns).toBe(
    (info.project.use.viewport?.width ?? 0) >= 1280
      ? 3
      : (info.project.use.viewport?.width ?? 0) >= 768
        ? 2
        : 1,
  );
  await accessible(page);
});

test("Spotify demo writes real items, records demo provenance and syncing again keeps URLs and counts", async ({
  page,
}) => {
  await page.goto("/connect/spotify");
  await expect(page.getByText("Demo data", { exact: true })).toBeVisible();
  const checkboxes = page.getByRole("checkbox");
  await expect(checkboxes).toHaveCount(6);
  for (const box of await checkboxes.all()) await expect(box).toBeChecked();
  await accessible(page);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.locator('ol [aria-current="step"]')).toHaveText(/Sign in to Spotify/);
  await expect(page.getByText(/No sign-in is needed/)).toBeVisible();
  await page.getByRole("button", { name: "Continue with Spotify" }).click();
  await expect(page.getByRole("heading", { name: "Added 25 items to Media" })).toBeVisible();
  await expect(page.getByRole("link", { name: "See in Media" })).toHaveAttribute(
    "href",
    "/home/media",
  );
  const first = await connection(page, "spotify");
  expect(first.mode).toBe("demo");
  expect(first.lastOutcome).toBe("ok");
  expect(first.resourceUrls).toHaveLength(10);
  await accessible(page);
  await page.getByRole("button", { name: "Sync again" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue with Spotify" }).click();
  await expect(page.getByRole("heading", { name: "Added 25 items to Media" })).toBeVisible();
  const second = await connection(page, "spotify");
  expect(second.resourceUrls).toEqual(first.resourceUrls);
  expect(second.added).toBe(first.added);
  await page.goto("/connect");
  const card = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Spotify", exact: true }) });
  await expect(card.getByText("Synced just now")).toBeVisible();
  await expect(card.getByRole("link", { name: "Sync now — Spotify" })).toBeVisible();
});

test("Netflix accepts its CSV fixture, reports one malformed row and can retry an invalid export", async ({
  page,
}) => {
  await page.goto("/connect/netflix");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page.getByRole("button", { name: "Choose file", exact: true })).toBeVisible();
  await page.getByText("How to export from Netflix", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Export your Netflix data" })).toBeVisible();
  await accessible(page);
  await page.getByLabel(/Export file/).setInputFiles({
    name: "NetflixViewingHistory.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "Title,Date\nExample Movie,10/25/2026\nExample Episode,10/26/2026\nBad row,10/27/2026,extra\n",
    ),
  });
  await expect(page.getByRole("heading", { name: "Added 2 items to Media" })).toBeVisible();
  await expect(
    page.getByText("1 item couldn't be read and was skipped", { exact: true }),
  ).toBeVisible();
  await accessible(page);
  await page.getByRole("button", { name: "Sync again" }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel(/Export file/).setInputFiles({
    name: "empty.csv",
    mimeType: "text/csv",
    buffer: Buffer.from('Title,Date\n"unfinished'),
  });
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  expect((await connection(page, "netflix")).lastOutcome).toBe("error");
  await accessible(page);
  await page.goto("/connect");
  await expect(page.getByText("Last sync incomplete", { exact: true })).toBeVisible();
});

test("offline catalogue disables every action and the flow is replaced until reconnection", async ({
  page,
  context,
}) => {
  await page.goto("/connect");
  await expect(page.getByRole("heading", { level: 1, name: "Connect services" })).toBeVisible();
  await context.setOffline(true);
  const actions = page.locator(".hm-connect-card-action button");
  await expect(actions).toHaveCount(18);
  for (const action of await actions.all()) await expect(action).toBeDisabled();
  await expect(page.locator('[title="Reconnect to connect services"]')).toHaveCount(18);
  await accessible(page);
  await context.setOffline(false);
  await page.goto("/connect/spotify");
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
  await context.setOffline(true);
  await expect(
    page.getByRole("heading", { name: "Connecting services needs a connection" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await accessible(page);
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toBeVisible();
});

test("unknown connectors are not found", async ({ page }) => {
  const response = await page.goto("/connect/not-a-service");
  expect(response?.status()).toBe(404);
});

test("cancelling a pending file import preserves incomplete status across reload", async ({
  page,
}) => {
  await page.goto("/connect/netflix");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.evaluate(() => {
    // A source that has not produced its first bytes makes cancellation
    // observable without timing sleeps or changing production session code.
    File.prototype.stream = () => new ReadableStream<Uint8Array<ArrayBuffer>>();
  });
  await page.getByLabel(/Export file/).setInputFiles({
    name: "NetflixViewingHistory.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("Title,Date\nExample,10/25/2026\n"),
  });
  await expect(page.getByRole("progressbar", { name: "Import progress" })).toBeVisible();
  await expect(page.locator('ol [aria-current="step"]')).toHaveText(/Importing/);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Last sync incomplete" })).toBeVisible();
  expect((await connection(page, "netflix")).lastOutcome).toBe("incomplete");
  await accessible(page);
  await page.goto("/connect");
  await expect(page.getByText("Last sync incomplete", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Last sync incomplete", { exact: true })).toBeVisible();
});
