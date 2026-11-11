// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { seedDemoSession } from "../demo-session";

test.use({ locale: "en-GB" });
test.beforeEach(async ({ page }) => {
  // Copied from money.spec.ts: reset the durable pod and remember the demo account.
  await seedDemoSession(page);
  await page.clock.setFixedTime(new Date("2026-11-01T12:00:00Z"));
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

async function accessible(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(result.violations).toEqual([]);
  await expect(page.getByRole("main").getByRole("heading", { level: 1 })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

async function seed(page: Page) {
  await page.goto("/money");
  await page.waitForFunction(() => {
    const pod = window.__suiteDemoPod;
    return !!pod?.has(new URL("money/.sample-complete", pod.root).href);
  });
  await expect(
    page.getByRole("heading", { name: "Overview", level: 1, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Current account", exact: true }),
  ).toBeVisible();
}

async function emptyMoney(page: Page, removeContainers: boolean) {
  await seed(page);
  await page.evaluate(async (removeContainers) => {
    const pod = window.__suiteDemoPod;
    if (!pod) throw new Error("Missing demo fixture hook");
    const root = new URL("money/", pod.root).href;
    const snapshot = pod.snapshot();
    for (const [url] of snapshot.resources) {
      // The completion marker prevents demo seeding from restoring deliberately deleted data.
      if (!url.startsWith(root) || url === `${root}.sample-complete`) continue;
      const current = await pod.fetch(url);
      const etag = current.headers.get("etag");
      if (!current.ok || !etag) throw new Error(`Can't read deletion fixture: ${url}`);
      const deleted = await pod.fetch(url, { method: "DELETE", headers: { "if-match": etag } });
      if (!deleted.ok) throw new Error(`Can't delete fixture: ${url}`);
    }
    if (removeContainers) {
      const containers = snapshot.containers
        .map(([url]) => url)
        .filter((url) => url.startsWith(root) && url !== root)
        .sort((a, b) => b.length - a.length);
      for (const url of containers) {
        const current = await pod.fetch(url);
        const etag = current.headers.get("etag");
        if (!current.ok || !etag) throw new Error(`Can't read container fixture: ${url}`);
        const deleted = await pod.fetch(url, { method: "DELETE", headers: { "if-match": etag } });
        if (!deleted.ok) throw new Error(`Can't delete container fixture: ${url}`);
      }
    }
  }, removeContainers);
}

async function breakDocument(page: Page, path: string) {
  return page.evaluate(async (path) => {
    const pod = window.__suiteDemoPod;
    if (!pod) throw new Error("Missing demo fixture hook");
    const url = new URL(`money/${path}`, pod.root).href;
    const current = await pod.fetch(url);
    const etag = current.headers.get("etag");
    if (!current.ok || !etag) throw new Error(`Can't read fixture: ${url}`);
    const body = await current.text();
    const broken = await pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-match": etag },
      body: "not Turtle {{{",
    });
    if (!broken.ok) throw new Error(`Can't break fixture: ${url}`);
    return { url, body };
  }, path);
}

async function repair(page: Page, saved: { url: string; body: string }) {
  await page.evaluate(async ({ url, body }) => {
    const pod = window.__suiteDemoPod;
    if (!pod) throw new Error("Missing demo fixture hook");
    const current = await pod.fetch(url);
    const etag = current.headers.get("etag");
    if (!current.ok || !etag) throw new Error("Can't read broken fixture");
    const restored = await pod.fetch(url, {
      method: "PUT",
      headers: { "content-type": "text/turtle", "if-match": etag },
      body,
    });
    if (!restored.ok) throw new Error("Can't restore fixture");
  }, saved);
}

const routes = [
  ["/money", "No accounts yet", "button", "Add an account"],
  ["/money/accounts", "No accounts yet", "button", "Add an account"],
  ["/money/budget", "Assign money to categories to start budgeting", "link", "Add categories"],
  ["/money/categories", "No categories yet", "button", "Add category"],
  ["/money/import", "No account to import into yet", "button", "Create an account"],
  ["/money/recurring", "No recurring payments yet", "link", "Import a statement"],
  ["/money/reports", "Nothing to report yet", "link", "Import a statement"],
  ["/money/rules", "Add a category first", "link", "Go to categories"],
  ["/money/search", "No transactions to search yet", "link", "Import a statement"],
] as const;

for (const removeContainers of [false, true]) {
  for (const [route, heading, role, action] of routes) {
    test(`${route}: first use with ${removeContainers ? "absent" : "empty"} collections`, async ({
      page,
    }) => {
      await emptyMoney(page, removeContainers);
      await page.goto(route);
      await page.reload();
      const state = page
        .getByRole("status")
        .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
      await expect(state.getByRole("heading", { name: heading, exact: true })).toBeVisible();
      const primary = state.getByRole(role, { name: action, exact: true });
      await primary.focus();
      await expect(primary).toBeFocused();
      await accessible(page);
      // Verify the action opens a real flow, using the keyboard on every route.
      await primary.press("Enter");
      if (role === "button") {
        const dialogName = route === "/money/categories" ? "Add category" : "Add account";
        await expect(page.getByRole("dialog", { name: dialogName, exact: true })).toBeVisible();
      } else {
        const destination =
          route === "/money/budget" || route === "/money/rules"
            ? "/money/categories"
            : "/money/import";
        await expect(page).toHaveURL(new RegExp(`${destination}$`));
      }
      await accessible(page);
    });
  }
}

test("a required categories document fails clearly and Retry re-reads the repaired document", async ({
  page,
}) => {
  await seed(page);
  const saved = await breakDocument(page, "categories.ttl");
  await page.goto("/money/categories");
  await expect(
    page.getByRole("heading", { level: 1, name: "Couldn't open your categories", exact: true }),
  ).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  await accessible(page);
  // Hold notification debounce timers so this tests Retry, independently of live revalidation.
  await page.clock.pauseAt(new Date("2026-11-01T12:00:01Z"));
  await repair(page, saved);
  await retry.click();
  const heading = page.getByRole("heading", { level: 1, name: "Categories", exact: true });
  await expect(heading).toBeFocused();
  await expect(page.getByRole("tree", { name: "Categories", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.clock.resume();
  await accessible(page);
});

test("one unreadable month keeps other transactions visible, supports dismissal and retries", async ({
  page,
}) => {
  await seed(page);
  const saved = await breakDocument(page, "transactions/2026-09.ttl");
  await page.goto("/money/search?q=Northbank");
  const notice = page.getByRole("status", { name: "Money read problems", exact: true });
  await expect(notice).toContainText("1 item couldn't be read");
  await expect(
    page
      .getByRole("main")
      .getByRole("link", { name: "Northbank Studio · Salary", exact: true })
      .first(),
  ).toBeVisible();
  await accessible(page);
  await notice.getByRole("button", { name: "Dismiss read problems", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await accessible(page);
  await page.reload();
  await expect(notice).toContainText("1 item couldn't be read");
  await page.clock.pauseAt(new Date("2026-11-01T12:00:01Z"));
  await repair(page, saved);
  await notice.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect(
    page.getByRole("heading", { level: 1, name: "Results for “Northbank”", exact: true }),
  ).toBeFocused();
  await page.clock.resume();
  await accessible(page);
});

test("search with no matches is distinct from first use", async ({ page }) => {
  await seed(page);
  await page.goto("/money/search?q=NoSuchPayee");
  await expect(
    page.getByRole("heading", { name: "No results for 'NoSuchPayee'", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Clear search", exact: true })).toBeVisible();
  await accessible(page);
});
