// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";

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
  await expect(overflow.getByRole("button", { name: /^Personal plan 6,/ })).toBeVisible();
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
