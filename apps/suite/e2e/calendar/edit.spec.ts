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
  if (await navigation.isVisible()) await page.keyboard.press("Escape");
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
  await form.getByLabel("Frequency", { exact: true }).selectOption("WEEKLY");
  await form.getByLabel("Ends", { exact: true }).selectOption("after");
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
  await expect(page.locator('.cal-month [data-day="2027-01-04"] button.cal-event')).toHaveCount(1);
  const occurrence = await editOccurrence(page, "2027-01-11", "Weekly planning");
  await occurrence.getByLabel("Title", { exact: true }).fill("Personal planning");
  await occurrence.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "This event", exact: true })
    .click();
  await expect(
    page.locator('.cal-month [data-day="2027-01-11"] button.cal-event'),
  ).toHaveAccessibleName(/^Personal planning,/);
  await expect(
    page.locator('.cal-month [data-day="2027-01-04"] button.cal-event'),
  ).toHaveAccessibleName(/^Weekly planning,/);
  const later = await editOccurrence(page, "2027-01-18", "Weekly planning");
  await later.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "This and following events", exact: true })
    .click();
  await expect(page.locator('.cal-month [data-day="2027-01-18"] button.cal-event')).toHaveCount(0);
  await expect(page.locator('.cal-month [data-day="2027-01-25"] button.cal-event')).toHaveCount(0);
  await expect(page.locator('.cal-month [data-day="2027-01-04"] button.cal-event')).toHaveCount(1);
  await expect(page.locator('.cal-month [data-day="2027-01-11"] button.cal-event')).toHaveCount(1);
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
  // The model's importICal/exportICal round trip is unit-tested; Playwright's ESM loader cannot
  // load rrule's CommonJS build, so the browser test checks the exported file's structure.
  const ics = await readFile((await file.path())!, "utf8");
  const lines = ics.replace(/\r\n[ \t]/g, "").split(/\r\n/);
  expect(lines[0]).toBe("BEGIN:VCALENDAR");
  expect(lines.filter((line) => line === "BEGIN:VEVENT")).toHaveLength(count);
  expect(lines.filter((line) => line === "END:VEVENT")).toHaveLength(count);
  expect(lines.filter((line) => /^SUMMARY[:;].*Imported /.test(line))).toHaveLength(5);
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
