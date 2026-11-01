// AUTHORED-BY Codex GPT-6.1-Sol
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import type { DemoPodSnapshot } from "../../src/lib/demo-pod/pod";

const fixture = new URL("./fixtures/five-events.ics", import.meta.url);
test.use({ locale: "en-GB", timezoneId: "Europe/London" });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-11-01T12:00:00Z"));
});
async function open(page: Page, date = "2027-01-01") {
  await page.goto(`/calendar/month?d=${date}`);
  await expect(page.getByRole("grid", { name: "Month calendar" })).toBeVisible();
}
async function quick(page: Page, day = "2027-01-04") {
  const cell = page.locator(`.cal-month [data-day="${day}"]`);
  await cell.focus();
  await cell.press("Enter");
  return page.getByRole("dialog", { name: "Create event", exact: true });
}
async function editor(page: Page) {
  return (page.viewportSize()?.width ?? 0) >= 1024
    ? page.getByRole("dialog", { name: /^(New|Edit) event$/ })
    : page.getByRole("region", { name: /^(New|Edit) event$/ });
}
async function editOccurrence(page: Page, day: string, name: string) {
  await page
    .locator(`.cal-month [data-day="${day}"]`)
    .getByRole("button", { name: new RegExp(`^${name},`) })
    .click();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  const form = await editor(page);
  await expect(form).toBeVisible();
  return form;
}
async function menu(page: Page, title = "Work") {
  const narrow = (page.viewportSize()?.width ?? 0) < 1024;
  if (narrow) await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("button", { name: `${title} calendar menu`, exact: true }).click();
}
async function closeNavigation(page: Page) {
  const navigation = page.getByRole("dialog", { name: "Navigation", exact: true });
  if (await navigation.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(navigation).toBeHidden();
  }
}
// The demo seed has a Mon/Wed/Fri stand-up, so match the planning series by title.
function planning(page: Page, day: string) {
  return page
    .locator(`.cal-month [data-day="${day}"] button.cal-event`)
    .filter({ hasText: /planning/ });
}
test("quick-create, edit one occurrence and delete following with accessible forms", async ({
  page,
}) => {
  await open(page);
  const popover = await quick(page);
  await popover.getByLabel("Title", { exact: true }).fill("Weekly planning");
  expect((await new AxeBuilder({ page }).include(".cal-quick").analyze()).violations).toEqual([]);
  await popover.getByRole("button", { name: "More options", exact: true }).click();
  const form = await editor(page);
  await expect(form.getByLabel("Title", { exact: true })).toHaveValue("Weekly planning");
  await form.getByRole("combobox", { name: "Frequency", exact: true }).selectOption("WEEKLY");
  await form.getByRole("combobox", { name: "Ends", exact: true }).selectOption("after");
  await form.getByLabel("Occurrences", { exact: true }).fill("6");
  await form.getByRole("button", { name: "Add reminder", exact: true }).click();
  await form.getByLabel("Reminder 1", { exact: true }).selectOption("-PT1H");
  expect(
    (
      await new AxeBuilder({ page })
        .include((page.viewportSize()?.width ?? 0) >= 1024 ? ".cal-editor" : ".cal-editor-page")
        .analyze()
    ).violations,
  ).toEqual([]);
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\/month\?d=2027-01-01$/);
  await expect(planning(page, "2027-01-04")).toHaveCount(1);
  const occurrence = await editOccurrence(page, "2027-01-11", "Weekly planning");
  await occurrence.getByLabel("Title", { exact: true }).fill("Personal planning");
  await occurrence.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "This event", exact: true })
    .click();
  await expect(
    planning(page, "2027-01-11"),
  ).toHaveAccessibleName(/^Personal planning,/);
  await expect(
    planning(page, "2027-01-04"),
  ).toHaveAccessibleName(/^Weekly planning,/);
  const later = await editOccurrence(page, "2027-01-18", "Weekly planning");
  await later.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "This and following events", exact: true })
    .click();
  await expect(planning(page, "2027-01-18")).toHaveCount(0);
  await expect(planning(page, "2027-01-25")).toHaveCount(0);
  await expect(planning(page, "2027-01-04")).toHaveCount(1);
  await expect(planning(page, "2027-01-11")).toHaveCount(1);
});
test("announces invalid dates and confirms discarding a dirty draft", async ({ page }) => {
  await open(page);
  const popover = await quick(page);
  await popover.getByRole("button", { name: "More options", exact: true }).click();
  const form = await editor(page);
  await form.getByLabel("Title", { exact: true }).fill("Invalid dates");
  await form.getByLabel("End (exclusive)", { exact: true }).fill("3 Jan 2027");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form.getByRole("alert")).toHaveText("End must be after start.");
  await form.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\/month\?d=2027-01-01$/);
});
test("quick-add parses the time and Escape returns focus to the empty slot", async ({ page }) => {
  await page.goto("/calendar/week?d=2026-11-02");
  const slot = page.locator('[data-slot="2026-11-02:26"]');
  await slot.focus();
  await slot.press("Enter");
  const popover = page.getByRole("dialog", { name: "Create event", exact: true });
  await popover.getByLabel("Title", { exact: true }).fill("Lunch with Sam tomorrow 1pm");
  await popover.getByLabel("Title", { exact: true }).press("Tab");
  await expect(popover.getByRole("status")).toContainText("13:00");
  await page.keyboard.press("Escape");
  await expect(slot).toBeFocused();
});
test("imports five fixture events and exports all calendar masters as parseable ICS", async ({
  page,
}) => {
  await open(page, "2026-11-01");
  await menu(page);
  await page.getByRole("menuitem", { name: "Import…", exact: true }).click();
  await page.getByLabel("Import ICS file", { exact: true }).setInputFiles(fixture.pathname);
  const dialog = page.getByRole("dialog", { name: "Import calendar events", exact: true });
  await expect(dialog.getByText("5 events · 0 skipped", { exact: true })).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include(".cal-import-dialog").analyze()).violations,
  ).toEqual([]);
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText("5 imported, 0 failed");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await closeNavigation(page);
  await page.getByRole("combobox", { name: "Calendar view", exact: true }).selectOption("agenda");
  for (const name of ["breakfast", "lunch", "walk", "concert", "holiday"])
    await expect(page.getByRole("button", { name: new RegExp(`^Imported ${name},`) })).toHaveCount(
      1,
    );
  // Give the download both a timed UNTIL edit and a timed split to validate.
  await page.goto("/calendar/month?d=2026-11-01");
  const series = await editOccurrence(page, "2026-11-02", "Imported breakfast");
  await series.getByRole("combobox", { name: "Frequency", exact: true }).selectOption("WEEKLY");
  await series.getByRole("combobox", { name: "Ends", exact: true }).selectOption("on");
  await series.getByLabel("End date", { exact: true }).fill("2026-11-30");
  await series.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar\/month\?d=2026-11-01$/);
  const changed = await editOccurrence(page, "2026-11-09", "Imported breakfast");
  await changed.getByLabel("Title", { exact: true }).fill("Imported breakfast edited");
  await changed.getByLabel("Start", { exact: true }).fill("9 Nov 2026 9am");
  await changed.getByLabel("End", { exact: true }).fill("9 Nov 2026 10am");
  await changed.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "This and following events", exact: true })
    .click();
  await expect(page).toHaveURL(/\/calendar\/month\?d=2026-11-01$/);
  await expect(
    page
      .locator('.cal-month [data-day="2026-11-09"] button.cal-event')
      .filter({ hasText: "Imported breakfast edited" }),
  ).toHaveCount(1);
  const count = await page.evaluate(async () => {
    const request = indexedDB.open("solid-suite-demo", 1);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const stored = await new Promise<{ snapshot: DemoPodSnapshot }>((resolve, reject) => {
      const tx = db.transaction("pods");
      const request = tx.objectStore("pods").get("https://alice.demo.pod/");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return stored.snapshot.resources.filter(
      ([url]) => url.startsWith("https://alice.demo.pod/calendar/work/") && url.endsWith(".ttl"),
    ).length;
  });
  await menu(page);
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "Export (.ics)", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe("Work.ics");
  // Preserve content-line checks and parse the actual download through the app's import dialog.
  const ics = await readFile(await file.path(), "utf8");
  const lines = ics.replace(/\r\n[ \t]/g, "").split(/\r\n/);
  expect(lines[0]).toBe("BEGIN:VCALENDAR");
  expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(count);
  expect(lines.filter((line) => line === "END:VEVENT")).toHaveLength(count);
  expect(lines.filter((line) => /^SUMMARY[:;].*Imported /.test(line))).toHaveLength(6);
  expect(lines.some((line) => /^RRULE:.*UNTIL=20261109T075959Z/.test(line))).toBe(true);
  expect(lines.some((line) => /^RRULE:.*UNTIL=20261130T235959Z/.test(line))).toBe(true);
  await closeNavigation(page);
  if ((page.viewportSize()?.width ?? 0) < 1024)
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("button", { name: "Create calendar", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create calendar", exact: true });
  await create.getByLabel("Name", { exact: true }).fill("Roundtrip");
  await create.getByRole("button", { name: "Create", exact: true }).click();
  await expect(create).toBeHidden();
  await closeNavigation(page);
  await menu(page, "Roundtrip");
  await page.getByRole("menuitem", { name: "Import…", exact: true }).click();
  await page.getByLabel("Import ICS file", { exact: true }).setInputFiles({
    name: file.suggestedFilename(),
    mimeType: "text/calendar",
    buffer: Buffer.from(ics),
  });
  await expect(dialog.getByText(`${count} events · 0 skipped`, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Import warnings" })).toHaveCount(0);
  await expect(dialog.getByLabel("Target calendar", { exact: true })).toHaveValue(
    "https://alice.demo.pod/calendar/roundtrip.ttl#it",
  );
  await dialog.getByRole("button", { name: "Import", exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(`${count} imported, 0 failed`);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await closeNavigation(page);
  if ((page.viewportSize()?.width ?? 0) < 1024)
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  await page.getByRole("checkbox", { name: "Show Work calendar", exact: true }).uncheck();
  await page.getByRole("checkbox", { name: "Show Personal calendar", exact: true }).uncheck();
  await closeNavigation(page);
  await page.getByRole("combobox", { name: "Calendar view", exact: true }).selectOption("agenda");
  await expect(page.getByRole("button", { name: /^Imported breakfast,/ })).toHaveCount(1);
  const edited = page.getByRole("button", { name: /^Imported breakfast edited,/ });
  await expect(edited).toHaveCount(4);
  for (const event of await edited.all())
    await expect(event).toHaveAccessibleName(/09:00.*Roundtrip/);
  for (const name of ["lunch", "walk", "concert", "holiday"])
    await expect(page.getByRole("button", { name: new RegExp(`^Imported ${name},`) })).toHaveCount(
      1,
    );
});
test("drops ICS into the default visible calendar", async ({ page }) => {
  await open(page, "2026-11-01");
  const text = await readFile(fixture, "utf8");
  const transfer = await page.evaluateHandle((text) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], "five-events.ics", { type: "text/calendar" }));
    return transfer;
  }, text);
  await page
    .locator(".cal-drop-area .su-drop-zone")
    .dispatchEvent("dragenter", { dataTransfer: transfer });
  await expect(page.getByText(/^Drop to import into /)).toBeVisible();
  await page
    .locator(".cal-drop-area .su-drop-zone")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(
    page.getByRole("dialog", { name: "Import calendar events" }).getByText("5 events · 0 skipped"),
  ).toBeVisible();
  await transfer.dispose();
});
test("keeps offline saves across reload and syncs after reconnecting", async ({
  page,
  context,
}) => {
  await open(page);
  const popover = await quick(page);
  await popover.getByLabel("Title", { exact: true }).fill("Offline event");
  await context.setOffline(true);
  await popover.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved on this device, will sync", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Offline event,/ })).toHaveCount(1);
  await context.setOffline(false);
  await expect(page.locator(".cal-sync-status")).toHaveText("Saved");
  await page.reload();
  await expect(page.getByRole("button", { name: /^Offline event,/ })).toHaveCount(1);
  const queued = await page.evaluate(
    () =>
      JSON.parse(
        localStorage.getItem("suite:calendar:outbox:https://alice.demo.pod/profile/card#me") ??
          '{"writes":[]}',
      ).writes.length,
  );
  expect(queued).toBe(0);
});

test("warns and skips a New York recurring import instead of shifting its London occurrence", async ({
  page,
}) => {
  await open(page, "2026-10-01");
  await menu(page);
  await page.getByRole("menuitem", { name: "Import…", exact: true }).click();
  await page.getByLabel("Import ICS file", { exact: true }).setInputFiles({
    name: "new-york.ics",
    mimeType: "text/calendar",
    buffer: Buffer.from(
      "BEGIN:VCALENDAR\nBEGIN:VEVENT\nUID:ny\nSUMMARY:New York weekly\nDTSTART;TZID=America/New_York:20261018T090000\nRRULE:FREQ=WEEKLY;COUNT=4\nEND:VEVENT\nEND:VCALENDAR",
    ),
  });
  const dialog = page.getByRole("dialog", { name: "Import calendar events", exact: true });
  await expect(dialog.getByText("0 events · 1 skipped", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("list", { name: "Import warnings" })).toContainText(
    '"New York weekly": recurring events in America/New_York cannot yet retain their timezone.',
  );
  await expect(dialog.getByRole("button", { name: "Import", exact: true })).toBeDisabled();
});
