// AUTHORED-BY Claude Opus 5.5
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

// Inlined rather than imported: e2e specs must not reach app modules.
const HINT = "You're offline. Changes are saved on this device and sync when you reconnect.";
const REASON = "You're offline. This needs a connection.";
const OUTBOX_KEY = "suite.outbox.v1.demo";

async function accessible(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((v) => v.impact === "serious" || v.impact === "critical"),
  ).toEqual([]);
}
async function signInDemo(page: Page) {
  await page.goto("/signin?next=%2Fsearch");
  await page.getByRole("button", { name: "Try it with a demo pod" }).click();
  await expect(page).toHaveURL(/\/search$/);
}
/** The worker installs on the first shell visit and claims the page once it activates. */
async function workerInControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
function savedPage(page: Page, path: string) {
  return page.evaluate(async (path) => {
    for (const name of await caches.keys())
      if (name.startsWith("suite-pages-") && (await (await caches.open(name)).match(path)))
        return true;
    return false;
  }, path);
}
async function closeSheet(page: Page) {
  const sheet = page.getByRole("dialog", { name: "Sync status" });
  await page.keyboard.press("Escape");
  // An open tooltip takes the first Escape.
  if (await sheet.isVisible()) await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
}

test("offline: pill, one-time hint, reconnecting, saved pages and the /offline fallback", async ({
  page,
  context,
}) => {
  await signInDemo(page);
  await workerInControl(page);
  await page.goto("/notifications");
  await expect.poll(() => savedPage(page, "/notifications")).toBe(true);

  const offlinePill = page.getByRole("button", { name: "Offline — showing saved copies" });
  await expect(offlinePill).toHaveCount(0);
  await context.setOffline(true);
  await expect(offlinePill).toBeVisible();
  await expect(page.getByText(HINT)).toBeVisible();
  await accessible(page);

  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Reconnecting…" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Reconnecting|Offline/ })).toHaveCount(0);

  // Offline again, on a fresh load from the saved copy: the hint was already shown.
  await context.setOffline(true);
  await page.reload();
  await expect(offlinePill).toBeVisible();
  await page.waitForTimeout(1_000);
  await expect(page.getByText(HINT)).toHaveCount(0);

  // A page that was never opened falls back to /offline with the recent items.
  await page.goto("/tasks/upcoming");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "You're offline — open something you've viewed before",
    }),
  ).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent items" });
  await expect(recent.getByRole("link", { name: "Notifications" })).toHaveAttribute(
    "href",
    "/notifications",
  );
  await expect(recent.getByRole("link", { name: "Search" })).toHaveAttribute("href", "/search");
  await accessible(page);

  // Something viewed before opens from this device.
  await recent.getByRole("link", { name: "Search" }).click();
  await expect(page).toHaveURL(/\/search$/);
  await expect(offlinePill).toBeVisible();
  await context.setOffline(false);
});

test("sync sheet: waiting changes, Retry all and a conflict resolved with Keep both", async ({
  page,
  context,
}) => {
  const now = Date.now();
  await page.addInitScript(
    ({ key, value }) => {
      if (sessionStorage.getItem("outbox-seeded")) return;
      sessionStorage.setItem("outbox-seeded", "1");
      localStorage.setItem(key, value);
    },
    {
      key: OUTBOX_KEY,
      value: JSON.stringify({
        pending: [
          {
            id: "rename",
            label: "Rename project brief",
            where: "My Drive / Work",
            queuedAt: new Date(now - 120_000).toISOString(),
            state: "pending",
          },
          {
            id: "notes",
            label: "Save meeting notes",
            where: "My Drive",
            queuedAt: new Date(now - 60_000).toISOString(),
            state: "failed",
            error: "Your storage could not save this change.",
          },
        ],
        conflicts: [
          {
            id: "brief",
            name: "Project brief",
            where: "My Drive / Work",
            summary: "You changed the title. Another device changed the introduction.",
            changedAt: new Date(now - 30_000).toISOString(),
          },
        ],
        lastSyncedAt: new Date(now - 3_600_000).toISOString(),
      }),
    },
  );
  await signInDemo(page);
  const pill = page.getByRole("button", { name: "1 conflict" });
  await pill.click();
  const sheet = page.getByRole("dialog", { name: "Sync status" });
  const waiting = sheet.getByRole("region", { name: "Waiting to sync" });
  await expect(waiting.getByRole("listitem")).toHaveCount(2);
  await expect(waiting.getByRole("listitem").first()).toContainText("Rename project brief");
  await expect(waiting.getByRole("listitem").first()).toContainText("My Drive / Work");
  await expect(waiting.getByRole("listitem").first().locator("time")).toHaveText(/ago/);
  await expect(sheet.getByRole("alert")).toHaveText("Your storage could not save this change.");
  await expect(sheet.getByText(/Last synced/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Retry all" })).toBeEnabled();
  await accessible(page);
  await closeSheet(page);

  // Offline the queue waits; Retry all needs a connection.
  await context.setOffline(true);
  await pill.click();
  await expect(sheet.getByRole("button", { name: "Retry all" })).toBeDisabled();
  await closeSheet(page);
  // Reconnecting sends what was waiting; the failed change waits for Retry.
  await context.setOffline(false);
  await expect(page.getByRole("button", { name: "Reconnecting…" })).toHaveCount(0);
  await pill.click();
  await expect(waiting.getByRole("listitem")).toHaveCount(1);
  await expect(waiting).toContainText("Save meeting notes");
  await sheet.getByRole("button", { name: "Retry all" }).click();
  await expect(waiting).toHaveCount(0);

  await sheet.getByRole("button", { name: "Resolve Project brief" }).click();
  const decision = page.getByRole("dialog", { name: "This item changed somewhere else" });
  await expect(decision.getByRole("button", { name: "Keep both" })).toBeFocused();
  await accessible(page);
  await decision.getByRole("button", { name: "Keep both" }).click();
  await expect(decision).toBeHidden();
  await expect(sheet.getByText("Everything is saved")).toBeVisible();
  await closeSheet(page);
  await expect(pill).toHaveCount(0);
  expect(
    await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}"), OUTBOX_KEY),
  ).toMatchObject({ pending: [], conflicts: [] });
});

test("requiresOnline: share changes are disabled offline with an explanation", async ({
  page,
  context,
}) => {
  await page.goto("/dev/components/share-dialog");
  await page.getByRole("button", { name: "Open share dialog" }).click();
  const dialog = page.getByRole("dialog", { name: "Share Project notes" });
  await dialog.getByRole("combobox", { name: "Add people", exact: true }).fill("Sage");
  await page.getByRole("option", { name: /Sage Brook/ }).click();
  const add = dialog.getByRole("button", { name: "Add", exact: true });
  await expect(add).toBeEnabled();
  await expect(dialog.getByRole("group", { name: REASON })).toHaveCount(0);

  await context.setOffline(true);
  await expect(add).toBeDisabled();
  const gate = dialog.getByRole("group", { name: REASON });
  await gate.hover();
  await expect(page.getByRole("tooltip")).toHaveText(REASON);
  await expect(dialog.getByText("Reconnect to change sharing", { exact: true })).toBeVisible();
  await accessible(page);

  await context.setOffline(false);
  await expect(add).toBeEnabled();
  await expect(gate).toHaveCount(0);
});
