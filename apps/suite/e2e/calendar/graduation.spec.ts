// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, type Page, test } from "@playwright/test";
import { accessible, editDemo, eventEditor, prepareCalendar } from "./fixtures";

test.use({ locale: "en-GB", timezoneId: "Europe/London" });
test.beforeEach(({ page }) => prepareCalendar(page));

async function open(page: Page, view = "day", date = "2026-11-02") {
  await page.goto(`/calendar/${view}?d=${date}`);
  await expect(page.getByText(/events loaded/)).toBeAttached();
}

async function firstRun(page: Page) {
  await open(page);
  await editDemo(page, "no-calendars");
  await expect(
    page.getByRole("heading", { name: "Your calendar starts here", exact: true }),
  ).toBeVisible();
}

async function createCalendar(page: Page, name: string) {
  // On desktop the sidebar also offers creation; use the editor/import surface.
  const surface = page.getByRole("dialog", { name: "Import calendar events", exact: true });
  const parent = (await surface.isVisible()) ? surface : eventEditor(page);
  await parent.getByRole("button", { name: "Create calendar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create calendar", exact: true });
  await dialog.getByLabel("Name", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).toBeHidden();
}

test("switches day, week, month and agenda while retaining the selected date", async ({ page }) => {
  await open(page);
  for (const view of ["week", "month", "agenda", "day"]) {
    await page.getByRole("combobox", { name: "Calendar view", exact: true }).selectOption(view);
    await expect(page).toHaveURL(new RegExp(`/calendar/${view}\\?d=2026-11-02$`));
    await expect(page.getByText(/events loaded/)).toBeAttached();
    if (view === "agenda")
      await expect(page.locator(".cal-agenda .cal-event").first()).toBeVisible();
    else
      await expect(
        page.getByRole("grid", {
          name:
            view === "month" ? "Month calendar" : `${view === "week" ? "Week" : "Day"} time grid`,
        }),
      ).toBeVisible();
    await accessible(page);
  }
});

test("quick-create saves an event and its details survive reload", async ({ page }) => {
  await open(page, "day", "2027-01-04");
  const slot = page.locator('[data-slot="2027-01-04:26"]');
  await slot.focus();
  await slot.press("Enter");
  const quick = page.getByRole("dialog", { name: "Create event", exact: true });
  await quick.getByLabel("Title", { exact: true }).fill("Launch review");
  await accessible(page);
  await quick.getByRole("button", { name: "Save", exact: true }).click();
  await expect(quick).toBeHidden();
  const event = page.getByRole("button", { name: /^Launch review,/ });
  await expect(event).toHaveCount(1);
  await expect(page.locator(".cal-sync-status")).toHaveText("Saved");
  await page.reload();
  await event.click();
  await expect(page.getByRole("heading", { name: "Launch review", exact: true })).toBeVisible();
  await expect(page.locator(".cal-details")).toContainText("13:00");
  await expect(page.locator(".cal-details")).toContainText("No reminders");
  await accessible(page);
});

test("event details list reminders and explain when none are set", async ({ page }) => {
  await open(page);
  await page.getByRole("button", { name: /^Team stand-up,/ }).click();
  await expect(page.getByRole("list", { name: "Reminders", exact: true })).toHaveText(
    "15 minutes before",
  );
  await accessible(page);
  await page.getByRole("button", { name: "Close event details", exact: true }).click();
  await open(page, "day", "2026-11-01");
  await page.getByRole("button", { name: /^Project planning,/ }).click();
  await expect(page.locator(".cal-details")).toContainText("No reminders");
  await expect(page.getByRole("list", { name: "Reminders", exact: true })).toHaveCount(0);
});

test("first-run New event creates a calendar and saves the first event", async ({ page }) => {
  await firstRun(page);
  await accessible(page);
  await page.locator("main").getByRole("link", { name: "New event", exact: true }).click();
  const form = eventEditor(page);
  await expect(form).toBeVisible();
  await form.getByLabel("Title", { exact: true }).fill("First plan");
  await createCalendar(page, "Family");
  await expect(form.getByLabel("Calendar", { exact: true })).toHaveValue(
    "https://alice.demo.pod/calendar/family.ttl#it",
  );
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue("First plan");
  await accessible(page);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\/day\?d=2026-11-02$/);
  await expect(page.getByRole("button", { name: /^First plan,/ })).toBeVisible();
  await expect(page.locator(".cal-sync-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByRole("button", { name: /^First plan,/ })).toBeVisible();
});

test("first-run Import .ics creates a calendar and imports the fixture", async ({ page }) => {
  await firstRun(page);
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import .ics", exact: true }).click();
  await (await chooser).setFiles(new URL("./fixtures/five-events.ics", import.meta.url).pathname);
  const dialog = page.getByRole("dialog", { name: "Import calendar events", exact: true });
  await expect(dialog.getByText("5 events · 0 skipped", { exact: true })).toBeVisible();
  await accessible(page);
  await createCalendar(page, "Imported");
  await expect(dialog.getByLabel("Target calendar", { exact: true })).toHaveValue(
    "https://alice.demo.pod/calendar/imported.ttl#it",
  );
  await accessible(page);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("5 imported, 0 failed");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("combobox", { name: "Calendar view", exact: true }).selectOption("agenda");
  for (const name of ["breakfast", "lunch", "walk", "concert", "holiday"])
    await expect(page.getByRole("button", { name: new RegExp(`^Imported ${name},`) })).toHaveCount(
      1,
    );
});

test("an empty agenda names its visible range and updates after Load more", async ({ page }) => {
  await open(page, "agenda", "2026-11-02");
  // Remove only event documents; keep both calendars registered and visible.
  await editDemo(page, [
    { path: "calendar/work/stand-up.ttl", body: null },
    { path: "calendar/personal/trip.ttl", body: null },
  ]);
  await expect(page.getByRole("heading", { name: "Nothing scheduled", exact: true })).toBeVisible();
  await expect(page.locator(".cal-agenda")).toContainText("2 Nov 2026 to 1 Dec 2026");
  await accessible(page);
  await page.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(page.locator(".cal-agenda")).toContainText("2 Nov 2026 to 31 Dec 2026");
  await accessible(page);
});

test("a calendar load failure offers Retry and recovers after storage is repaired", async ({
  page,
}) => {
  await open(page);
  const original = await editDemo(page, [{ path: "profile/card", body: "invalid Turtle" }]);
  const error = page.locator(".cal-screen .suite-async-error");
  await expect(error).toContainText(
    "We couldn't load your calendar. Check your connection and try again.",
  );
  await expect(page.getByRole("heading", { name: "Nothing scheduled", exact: true })).toBeHidden();
  await accessible(page);
  await error.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(error).toBeVisible();
  await editDemo(page, original);
  await expect(error).toBeHidden();
  await expect(page.getByRole("button", { name: /^Team stand-up,/ })).toBeVisible();
  await accessible(page);
});

test("partial load failures keep a warning and Retry instead of an empty agenda", async ({
  page,
}) => {
  await open(page, "agenda", "2027-01-04");
  const original = await editDemo(page, [
    { path: "calendar/work/stand-up.ttl", body: "invalid Turtle" },
  ]);
  const warning = page.locator(".cal-warning");
  await expect(warning).toContainText("Could not load events from Work");
  await expect(warning).toContainText(
    "Some events may be missing. Check your connection and try again.",
  );
  await expect(page.getByRole("heading", { name: "Nothing scheduled", exact: true })).toBeHidden();
  await accessible(page);
  await warning.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(warning).toBeVisible();
  await editDemo(page, original);
  await expect(warning).toBeHidden();
  await expect(page.getByRole("button", { name: /^Team stand-up,/ }).first()).toBeVisible();
});
