// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { buildEvent, serializeDataset } from "../../src/apps/calendar/lib/model/rdf";
import type { DemoPodSnapshot } from "../../src/lib/demo-pod/pod";

const ROOT = "https://alice.demo.pod/";
/** Change the same durable pod another tab reads, then send its real change notification. */
async function editDemo(page: Page, edits: { path: string; body: string | null }[]) {
  return page.evaluate(
    async ({ root, edits }) => {
      const request = indexedDB.open("solid-suite-demo", 1);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const originals: { path: string; body: string }[] = [];
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("pods", "readwrite");
        const store = tx.objectStore("pods");
        const read = store.get(root);
        read.onsuccess = () => {
          const stored = read.result as { revision: string; snapshot: DemoPodSnapshot };
          let resources = [...stored.snapshot.resources];
          let seq = stored.snapshot.etagSeq;
          for (const edit of edits) {
            const url = new URL(edit.path, root).href;
            const previous = resources.find(([key]) => key === url)?.[1];
            if (!previous) throw new Error(`Missing demo fixture: ${edit.path}`);
            originals.push({ path: edit.path, body: new TextDecoder().decode(previous.body) });
            resources = resources.filter(([key]) => key !== url);
            if (edit.body !== null)
              resources.push([
                url,
                {
                  ...previous,
                  body: new TextEncoder().encode(edit.body),
                  etag: `"regression-${++seq}"`,
                },
              ]);
          }
          store.put(
            {
              revision: crypto.randomUUID(),
              snapshot: { ...stored.snapshot, resources, etagSeq: seq },
            },
            root,
          );
        };
        tx.oncomplete = () => resolve();
        tx.onabort = tx.onerror = () => reject(tx.error);
      });
      db.close();
      const channel = new BroadcastChannel("solid-suite-demo-changes");
      channel.postMessage(root);
      channel.close();
      return originals;
    },
    { root: ROOT, edits },
  );
}

const DATE = "2026-11-01";
test.use({ locale: "en-GB", timezoneId: "Europe/London" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-01T12:00:00Z"));
});
async function open(page: Page, view = "week") {
  await page.goto(`/calendar/${view}?d=${DATE}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByText(/events loaded/)).toBeAttached();
}
async function sidebar(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
    return page.getByRole("dialog", { name: "Navigation", exact: true });
  }
  return page.getByRole("complementary", { name: "Calendar navigation", exact: true });
}

test("navigates months, keeps the date in the URL and restores view history", async ({ page }) => {
  await open(page, "month");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("November 2026");
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("December 2026");
  await expect(page).toHaveURL(/d=2026-12-01/);
  await page.getByRole("button", { name: "Previous month", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("November 2026");
  await page.getByRole("combobox", { name: "Calendar view", exact: true }).selectOption("week");
  await expect(page.getByRole("grid", { name: "Week time grid" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("November 2026");
});

test("hides Work in week and month and retains the WebID preference after reload", async ({
  page,
}) => {
  await open(page);
  await expect(page.getByRole("button", { name: /^Team stand-up,/ })).toHaveCount(3);
  const navigation = await sidebar(page);
  await navigation.getByRole("checkbox", { name: "Show Work calendar", exact: true }).uncheck();
  if ((page.viewportSize()?.width ?? 1280) < 1024) await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^Team stand-up,/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Dinner with friends,/ })).toHaveCount(1);
  await page.getByRole("combobox", { name: "Calendar view", exact: true }).selectOption("month");
  await expect(page.getByRole("grid", { name: "Month calendar" })).toBeVisible();
  await expect(page.getByRole("button", { name: /, Work$/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByText(/events loaded/)).toBeAttached();
  await expect(page.getByRole("button", { name: /, Work$/ })).toHaveCount(0);
});

test("moves through month days with the keyboard and opens a day", async ({ page }) => {
  await open(page, "month");
  await page.locator('.cal-month [data-day="2026-11-01"]').focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('.cal-month [data-day="2026-11-02"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.locator('.cal-month [data-day="2026-11-09"]')).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.locator('.cal-month [data-day="2026-11-15"]')).toBeFocused();
  await page.keyboard.press("Home");
  await expect(page.locator('.cal-month [data-day="2026-11-09"]')).toBeFocused();
  await page.keyboard.press("PageDown");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("December 2026");
  await expect(page.locator('.cal-month [data-day="2026-12-09"]')).toBeFocused();
  await page.keyboard.press("PageUp");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("November 2026");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/calendar\/day\?d=2026-11-09/);
});

test("moves across week slots, enters events with Tab, opens and closes details by keyboard", async ({
  page,
}) => {
  await open(page);
  const monday = page.locator('[data-slot="2026-10-26:14"]');
  await monday.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[data-slot="2026-10-27:14"]')).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator('[data-slot="2026-10-27:13"]')).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Tab");
  const event = page
    .locator('[data-event-day="2026-10-26"]')
    .getByRole("button", { name: /^Team stand-up,/ });
  await expect(event).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Team stand-up", exact: true })).toBeVisible();
  await expect(page.getByText("Weekly on Mon, Wed, Fri", { exact: true })).toBeVisible();
  await expect(page.getByText("15 minutes before", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close event details", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "Team stand-up", exact: true })).toHaveCount(0);
  await expect(event).toBeFocused();
  await event.press("Enter");
  await expect(page.getByRole("heading", { name: "Team stand-up", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Team stand-up", exact: true })).toHaveCount(0);
  await expect(event).toBeFocused();
  await monday.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/calendar\/day\?d=2026-10-26/);
});

test("shows recurring stand-ups on Mon/Wed/Fri, lays overlaps side by side and opens month overflow", async ({
  page,
}) => {
  await open(page);
  for (const day of ["2026-10-26", "2026-10-28", "2026-10-30"])
    await expect(
      page.locator(`[data-event-day="${day}"]`).getByRole("button", { name: /^Team stand-up,/ }),
    ).toHaveCount(1);
  const planning = page.getByRole("button", { name: /^Project planning,/ });
  const review = page.getByRole("button", { name: /^Design review,/ });
  const first = await planning.boundingBox();
  const second = await review.boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second?.x).toBeGreaterThan(first?.x ?? 0);
  await page.getByRole("combobox", { name: "Calendar view", exact: true }).selectOption("month");
  await page
    .locator('[data-day="2026-11-01"]')
    .getByRole("button", { name: /more events/ })
    .click();
  const overflow = page.getByRole("dialog", { name: /Events on/ });
  await expect(overflow).toBeVisible();
  await expect(overflow.getByRole("button", { name: /^Read in the park,/ })).toBeVisible();
});

for (const close of ["button", "Escape"] as const) {
  test(`restores keyboard focus to a month overflow event after closing Details with ${close}`, async ({
    page,
  }) => {
    await open(page, "month");
    const more = page
      .locator('[data-day="2026-11-01"]')
      .getByRole("button", { name: /more events/ });
    await more.focus();
    await page.keyboard.press("Enter");
    const overflow = page.getByRole("dialog", { name: /Events on/ });
    const event = overflow.getByRole("button", { name: /^Read in the park,/ });
    await event.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Read in the park", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Close event details", exact: true }),
    ).toBeFocused();
    if (close === "button") await page.keyboard.press("Enter");
    else await page.keyboard.press("Escape");
    await expect(page.locator(".cal-details")).toHaveCount(0);
    await expect(overflow).toBeVisible();
    await expect(event).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(overflow).toBeHidden();
    await expect(more).toBeFocused();
  });
}

test("restores the connected overflow button if its selected event is removed during Details", async ({
  page,
}) => {
  await open(page, "month");
  const day = page.locator('[data-day="2026-11-01"]');
  const more = day.getByRole("button", { name: /more events/ });
  await more.click();
  const event = page
    .locator(".cal-overflow")
    .getByRole("button", { name: /^Read in the park,/, includeHidden: true });
  await event.click();
  await expect(page.locator(".cal-details")).toBeVisible();
  // Simulate a detached trigger while keeping the selected Details open.
  await event.evaluate((button) => button.remove());
  await page.getByRole("button", { name: "Close event details", exact: true }).click();
  await expect(page.locator(".cal-details")).toHaveCount(0);
  await expect(more).toBeFocused();
});

test("searches the labelled six-month window and opens a read-only result", async ({ page }) => {
  await open(page);
  await page.getByRole("searchbox", { name: "Search in Calendar", exact: true }).fill("Dinner");
  await page.getByRole("searchbox", { name: "Search in Calendar", exact: true }).press("Enter");
  await expect(page).toHaveURL(/\/calendar\/search\?q=Dinner/);
  await expect(page.getByText(/Searching events from/)).toBeVisible();
  await page.getByRole("button", { name: /^Dinner with friends,/ }).click();
  await expect(
    page.getByRole("heading", { name: "Dinner with friends", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Bring something to share.", { exact: true })).toBeVisible();
});

test("creates a named calendar with a persisted colour", async ({ page }) => {
  await open(page);
  const navigation = await sidebar(page);
  await navigation.getByRole("button", { name: "Create calendar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create calendar", exact: true });
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Family");
  await dialog.getByRole("radio", { name: "Colour 3", exact: true }).check();
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    navigation.getByRole("checkbox", { name: "Show Family calendar", exact: true }),
  ).toBeChecked();
});

for (const view of ["month", "week", "day", "agenda"]) {
  test(`${view} is accessible and fits the viewport`, async ({ page }) => {
    await open(page, view);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (view === "agenda") {
      await page.getByRole("button", { name: "Load more", exact: true }).click();
      await expect(page.getByRole("button", { name: "Load more", exact: true })).toBeVisible();
    }
  });
}

for (const [view, name, rows, cells] of [
  ["month", "Month calendar", 7, 42],
  ["week", "Week time grid", 48, 336],
  ["day", "Day time grid", 48, 48],
] as const) {
  test(`${view} exposes the main grid's rows and cells`, async ({ page }) => {
    await open(page, view);
    const grid = page.getByRole("grid", { name, exact: true });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole("row")).toHaveCount(rows);
    await expect(grid.getByRole("gridcell")).toHaveCount(cells);
  });
}

test("Tab advances through all-day and timed events and leaves the day without cycling", async ({
  page,
}) => {
  await open(page);
  await page.locator('[data-slot="2026-11-01:14"]').focus();
  const allDay = page.locator(".cal-all-day-events button.cal-event");
  const timed = page.locator('[data-event-day="2026-11-01"] button.cal-event');
  const expected = [...(await allDay.all()), ...(await timed.all())];
  expect(expected.length).toBeGreaterThan(3);
  for (const event of expected) {
    await page.keyboard.press("Tab");
    await expect(event).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-slot="2026-11-01:14"]')).not.toBeFocused();
  for (const event of expected) await expect(event).not.toBeFocused();
});

test("short timed chips keep one uncut line and full accessible details", async ({ page }) => {
  await open(page);
  const standup = page
    .locator('[data-event-day="2026-10-26"]')
    .getByRole("button", { name: /^Team stand-up,/ });
  const gym = page.getByRole("button", { name: /^Gym,/ });
  for (const [chip, label] of [
    [standup, "Team stand-up, 09:30"],
    [gym, "Gym, 13:00"],
  ] as const) {
    await chip.scrollIntoViewIfNeeded();
    await expect(chip.locator(".cal-event-title")).toHaveText(label);
    await expect(chip.locator(".cal-event-time")).toHaveCount(0);
    await expect(chip).toHaveAttribute("title", /Personal|Work/);
    await expect(chip).toHaveAccessibleName(/09:30–09:45|13:00–13:30/);
    expect(
      await chip.evaluate((button) => {
        const text = button.querySelector(".cal-event-title")?.getBoundingClientRect();
        const box = button.getBoundingClientRect();
        return Boolean(text && text.top >= box.top && text.bottom <= box.bottom);
      }),
    ).toBe(true);
  }
});

test("the Sunday seed shows the trip in the default week and month", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("button", { name: /^Three-day trip,/ })).toBeVisible();
  await page.getByRole("combobox", { name: "Calendar view", exact: true }).selectOption("month");
  const today = page
    .getByRole("grid", { name: "Month calendar" })
    .locator('[data-day="2026-11-01"]');
  await today.getByRole("button", { name: /more events/ }).click();
  await expect(
    page
      .getByRole("dialog", { name: /Events on/ })
      .getByRole("button", { name: /^Three-day trip,/ }),
  ).toBeVisible();
});

test("open details follow a remote rename and close after remote deletion", async ({ page }) => {
  await open(page);
  await page
    .locator('[data-event-day="2026-10-26"]')
    .getByRole("button", { name: /^Team stand-up,/ })
    .click();
  await expect(page.getByRole("heading", { name: "Team stand-up", exact: true })).toBeVisible();
  const path = "calendar/work/stand-up.ttl";
  const renamed = await serializeDataset(
    buildEvent(`${ROOT}${path}`, {
      name: "Renamed in another tab",
      start: new Date("2026-10-26T09:30:00Z"),
      end: new Date("2026-10-26T09:45:00Z"),
      recurrence: { frequency: "WEEKLY", byDay: ["MO", "WE", "FR"] },
      inCalendar: `${ROOT}calendar/work.ttl#it`,
    }),
  );
  await editDemo(page, [{ path, body: renamed }]);
  await expect(
    page.getByRole("heading", { name: "Renamed in another tab", exact: true }),
  ).toBeVisible();
  await editDemo(page, [{ path, body: null }]);
  await expect(
    page.getByRole("heading", { name: "Renamed in another tab", exact: true }),
  ).toHaveCount(0);
});

for (const path of ["profile/card", "settings/privateTypeIndex.ttl"]) {
  test(`search shows a discovery error and retries after repairing ${path}`, async ({ page }) => {
    await open(page);
    const original = await editDemo(page, [{ path, body: "deliberately invalid Turtle" }]);
    await page.goto(`/calendar/search?q=stand&d=${DATE}`);
    await expect(page.locator(".suite-async-error")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.locator(".suite-async-error")).toBeVisible();
    await editDemo(page, original);
    await expect(page.getByRole("button", { name: /^Team stand-up,/ }).first()).toBeVisible();
    await expect(page.locator(".suite-async-error")).toHaveCount(0);
  });
}

for (const view of ["week", "search"]) {
  test(`all failed calendars keep warnings and Retry visible in ${view}`, async ({ page }) => {
    await open(page);
    await editDemo(
      page,
      ["personal", "work"].map((slug) => ({
        path: `calendar/${slug}.ttl`,
        body: "deliberately invalid Turtle",
      })),
    );
    await page.goto(`/calendar/${view}?d=${DATE}&q=missing`);
    await expect(page.locator(".cal-warning")).toHaveCount(2);
    await expect(
      page.locator(".cal-warning").getByRole("button", { name: "Retry", exact: true }),
    ).toHaveCount(2);
    await expect(page.getByText("Your calendar starts here", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/No results for/)).toHaveCount(0);
  });
}

test("search keeps an event range failure visible when there are no matches", async ({ page }) => {
  await open(page);
  const original = await editDemo(page, [
    { path: "calendar/work/stand-up.ttl", body: "deliberately invalid Turtle" },
  ]);
  await page.goto(`/calendar/search?q=unmatched&d=${DATE}`);
  await expect(page.locator(".cal-warning")).toContainText("Could not load events from Work");
  await expect(
    page.locator(".cal-warning").getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await editDemo(page, original);
  await expect(page.locator(".cal-warning")).toHaveCount(0);
});

test("calendar creation can retry after its document succeeds but its container fails", async ({
  page,
}) => {
  await open(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let rejected = false;
    IDBObjectStore.prototype.put = function (value, key) {
      const stored = value as { snapshot?: DemoPodSnapshot };
      const request = put.call(this, value, key);
      if (
        !rejected &&
        stored.snapshot?.containers.some(([url]) => url.endsWith("/calendar/retry-calendar/"))
      ) {
        rejected = true;
        this.transaction.abort();
      }
      return request;
    };
  });
  const navigation = await sidebar(page);
  await navigation.getByRole("button", { name: "Create calendar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create calendar", exact: true });
  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Retry Calendar");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Couldn't create this calendar");
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(
    navigation.getByRole("checkbox", { name: "Show Retry Calendar calendar", exact: true }),
  ).toBeChecked();
});
