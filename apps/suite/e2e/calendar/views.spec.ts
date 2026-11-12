// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { buildEvent, serializeDataset } from "../../src/apps/calendar/lib/model/rdf";
import type { DemoPodSnapshot } from "../../src/lib/demo-pod/pod";
import { accessible, editDemo, prepareCalendar } from "./fixtures";

const ROOT = "https://alice.demo.pod/";
const DATE = "2026-11-01";
test.use({ locale: "en-GB", timezoneId: "Europe/London" });
test.beforeEach(({ page }) => prepareCalendar(page));
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
function phoneMonth(page: Page) {
  return (page.viewportSize()?.width ?? 1280) < 640;
}
function dayList(page: Page) {
  return phoneMonth(page)
    ? page.getByRole("region", { name: /^Events on/ })
    : page.getByRole("dialog", { name: /^Events on/ });
}
function moreEvents(page: Page) {
  const cell = page.locator('.cal-month [data-day="2026-11-01"]');
  return cell.getByRole("button", { name: /more events/ });
}

test("month bars span weeks and the phone day target opens its full agenda without page overflow", async ({
  page,
}) => {
  await open(page, "month");
  const grid = page.getByRole("grid", { name: "Month calendar" });
  const bars = grid.getByRole(phoneMonth(page) ? "img" : "button", { name: /^Three-day trip,/ });
  await expect(bars).toHaveCount(2);
  await expect(bars.first()).toHaveClass(/cal-continues-after/);
  await expect(bars.last()).toHaveClass(/cal-continues-before/);
  await expect(bars.last()).toHaveAccessibleName(
    "Three-day trip, Sun 1 Nov 2026 – Tue 3 Nov 2026, Personal",
  );
  const monday = grid.locator('[data-day="2026-11-02"]');
  const dayBox = await monday.boundingBox();
  const barBox = await bars.last().boundingBox();
  expect(barBox?.width).toBeGreaterThan((dayBox?.width ?? Infinity) * 1.8);
  expect(barBox?.width).toBeLessThanOrEqual((dayBox?.width ?? 0) * 2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    page.viewportSize()?.width ?? 0,
  );
  if (phoneMonth(page)) {
    await expect(grid.locator("button.cal-event")).toHaveCount(0);
    await expect(grid.locator('[data-day="2026-11-01"] .cal-phone-more')).toHaveText("+9");
    for (const button of await grid.locator(".cal-month-open").all()) {
      const box = await button.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await monday.getByRole("button", { name: /^Show events on/ }).click();
    const agenda = dayList(page);
    await expect(agenda).toHaveAccessibleName("Events on Monday, 2 November 2026");
    await expect(agenda.getByRole("button", { name: /^Three-day trip,/ })).toBeVisible();
    await expect(agenda.getByRole("button", { name: /^Team stand-up,/ })).toBeVisible();
    for (const button of await agenda.getByRole("button").all()) {
      expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    expect((await new AxeBuilder({ page }).include(".cal-screen").analyze()).violations).toEqual(
      [],
    );
  } else {
    await monday.focus();
    await monday.press("ArrowRight");
    await page.keyboard.press("Tab");
    await expect(bars.last()).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(grid.locator('[data-day="2026-11-03"]')).toBeFocused();
  }
});

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

test("moves through month days with the keyboard and opens quick-create", async ({ page }) => {
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
  await expect(page.getByRole("dialog", { name: "Create event", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('.cal-month [data-day="2026-11-09"]')).toBeFocused();
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
  await expect(page.getByRole("dialog", { name: "Create event", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(monday).toBeFocused();
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
  await moreEvents(page).click();
  const overflow = dayList(page);
  await expect(overflow).toBeVisible();
  await expect(overflow.getByRole("button", { name: /^Read in the park,/ })).toBeVisible();
});

for (const close of ["button", "Escape"] as const) {
  test(`restores keyboard focus to a month overflow event after closing Details with ${close}`, async ({
    page,
  }) => {
    await open(page, "month");
    const more = moreEvents(page);
    await more.focus();
    await page.keyboard.press("Enter");
    const overflow = dayList(page);
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
    if (phoneMonth(page)) return;
    await page.keyboard.press("Escape");
    await expect(overflow).toBeHidden();
    await expect(more).toBeFocused();
  });
}

test("restores the connected overflow button if its selected event is removed during Details", async ({
  page,
}) => {
  await open(page, "month");
  const day = page.locator('.cal-month [data-day="2026-11-01"]');
  const more = moreEvents(page);
  await more.click();
  const event = page
    .locator(phoneMonth(page) ? ".cal-month-agenda" : ".cal-overflow")
    .getByRole("button", {
      name: /^Read in the park,/,
      includeHidden: true,
    });
  await event.click();
  await expect(page.locator(".cal-details")).toBeVisible();
  // Simulate a detached trigger while keeping the selected Details open.
  await event.evaluate((button) => button.remove());
  await page.getByRole("button", { name: "Close event details", exact: true }).click();
  await expect(page.locator(".cal-details")).toHaveCount(0);
  await expect(phoneMonth(page) ? day : more).toBeFocused();
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
    await accessible(page);
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

test("adjacent 15-minute events have disjoint 24px click targets", async ({ page }) => {
  await open(page, "day");
  const edits = await Promise.all(
    [
      ["First short event", "13:00", "13:15"],
      ["Second short event", "13:15", "13:30"],
    ].map(async ([name, start, end], index) => {
      const path = `calendar/personal/busy-${index}.ttl`;
      return {
        path,
        body: await serializeDataset(
          buildEvent(`${ROOT}${path}`, {
            name: name as string,
            start: new Date(`${DATE}T${start}:00Z`),
            end: new Date(`${DATE}T${end}:00Z`),
            inCalendar: `${ROOT}calendar/personal.ttl#it`,
          }),
        ),
      };
    }),
  );
  await editDemo(page, edits);
  const first = page.getByRole("button", { name: /^First short event,/ });
  const second = page.getByRole("button", { name: /^Second short event,/ });
  await expect(first).toBeAttached();
  await expect(second).toBeAttached();
  await first.scrollIntoViewIfNeeded();
  const a = await first.boundingBox();
  const b = await second.boundingBox();
  if (!a || !b) throw new Error("Missing short event targets");
  expect(a.height).toBeGreaterThanOrEqual(24);
  expect(b.height).toBeGreaterThanOrEqual(24);
  expect(b.y - a.y).toBe(12);
  expect(a.x + a.width <= b.x || b.x + b.width <= a.x).toBe(true);
  for (const [chip, name] of [
    [first, "First short event"],
    [second, "Second short event"],
  ] as const) {
    await chip.click();
    await expect(page.locator(".cal-details h2")).toHaveText(name);
    await page.getByRole("button", { name: "Close event details", exact: true }).click();
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
  await expect(dayList(page).getByRole("button", { name: /^Three-day trip,/ })).toBeVisible();
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
  await expect(
    page.getByRole("button", { name: "Close event details", exact: true }),
  ).toBeFocused();
  await editDemo(page, [{ path, body: null }]);
  await expect(
    page.getByRole("heading", { name: "Renamed in another tab", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator("#main-content")).toBeFocused();
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
