// AUTHORED-BY Claude Opus 5.5
import { expect, type Page, test } from "@playwright/test";
import { encodeRef } from "../../src/lib/refs";

type ReminderHook = { setNow(value: string | number | null): void; tick(): Promise<number> };
type HookWindow = Window & { tasksReminderTestHook?: ReminderHook };
type RecordedNotification = { title: string; body?: string; tag?: string; click(): void };

test.use({ locale: "en-GB", timezoneId: "Europe/London" });
test.beforeEach(async ({ page }) => {
  await page.route("**/__reminders-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset</title>" }),
  );
  await page.goto("/__reminders-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    for (const name of ["solid-suite-demo", "tasks"])
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error(`${name} database deletion blocked`));
      });
  });
  await page.unroute("**/__reminders-reset");
});

/** Add "Call mum tomorrow 5pm" with an at-due-time reminder through the composer. */
async function addReminderTask(page: Page) {
  await page.goto("/tasks/inbox");
  await expect(
    page.getByRole("heading", { name: "Your Inbox is empty", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("q");
  const input = page.getByRole("textbox", { name: "Task title", exact: true });
  await input.fill("Call mum tomorrow 5pm");
  await page.getByRole("button", { name: "Reminder", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "At due time", exact: true }).click();
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await input.press("Escape");
  const row = page.locator("[data-task-url]").filter({ hasText: "Call mum" });
  await expect(row).toBeVisible();
  const url = await row.getAttribute("data-task-url");
  if (!url) throw new Error("Missing task URL");
  return url;
}
/** Move the reminder clock to one minute after tomorrow 17:00 and force a scheduler tick. */
async function fireTomorrowAtFive(page: Page): Promise<number> {
  await page.waitForFunction(() => Boolean((window as HookWindow).tasksReminderTestHook));
  return page.evaluate(async () => {
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(17, 1, 0, 0);
    const hook = (window as HookWindow).tasksReminderTestHook as ReminderHook;
    hook.setNow(at.getTime());
    let delivered = await hook.tick();
    // -1 means the project loads have not settled yet.
    while (delivered < 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      delivered = await hook.tick();
    }
    return delivered;
  });
}
function reminderToast(page: Page) {
  return page.locator("[data-sonner-toast]").filter({ hasText: "Reminder: Call mum" });
}

test("a due reminder shows one toast whose Open action opens the task", async ({ page }) => {
  const url = await addReminderTask(page);
  expect(await fireTomorrowAtFive(page)).toBe(1);
  const toast = reminderToast(page);
  await expect(toast).toBeVisible();
  await expect(toast).toContainText("Due today 17:00");
  // The trigger is recorded in IndexedDB: later ticks and reloads do not repeat it.
  expect(await fireTomorrowAtFive(page)).toBe(0);
  await expect(reminderToast(page)).toHaveCount(1);
  await toast.getByRole("button", { name: "Open", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Task details: Call mum", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("task")).toBe(encodeRef(url));
  await page.reload();
  expect(await fireTomorrowAtFive(page)).toBe(0);
  await expect(reminderToast(page)).toHaveCount(0);
});

test("a permitted Web Notification opens the task when clicked", async ({ page }) => {
  await page.addInitScript(() => {
    const recorded: RecordedNotification[] = [];
    class RecordingNotification extends EventTarget {
      static permission = "granted";
      static requestPermission = async () => "granted";
      onclick: (() => void) | null = null;
      constructor(title: string, options: NotificationOptions = {}) {
        super();
        recorded.push({
          title,
          ...(options.body ? { body: options.body } : {}),
          ...(options.tag ? { tag: options.tag } : {}),
          click: () => this.onclick?.(),
        });
      }
      close() {}
    }
    Object.assign(window, { Notification: RecordingNotification, recordedNotifications: recorded });
  });
  const url = await addReminderTask(page);
  // Permission is already granted, so saving a reminder does not offer notifications.
  await expect(page.getByText("Get a notification when reminders are due?")).toHaveCount(0);
  expect(await fireTomorrowAtFive(page)).toBe(1);
  const notifications = () =>
    page.evaluate(() =>
      (
        window as unknown as { recordedNotifications: RecordedNotification[] }
      ).recordedNotifications.map(({ title, body, tag }) => ({ title, body, tag })),
    );
  expect(await notifications()).toEqual([
    { title: "Call mum", body: "Due today 17:00", tag: expect.stringContaining(url) },
  ]);
  await expect(reminderToast(page)).toBeVisible();
  await page.evaluate(() =>
    (
      window as unknown as { recordedNotifications: RecordedNotification[] }
    ).recordedNotifications[0]?.click(),
  );
  await expect(
    page.getByRole("region", { name: "Task details: Call mum", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("task")).toBe(encodeRef(url));
});

test("saving a reminder offers notifications once, without prompting on load", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Notification, "permission", { configurable: true, get: () => "default" });
    Object.assign(window, { permissionRequests: 0 });
    Notification.requestPermission = async () => {
      (window as unknown as { permissionRequests: number }).permissionRequests++;
      return "denied";
    };
  });
  await addReminderTask(page);
  const offer = page.locator("[data-sonner-toast]").filter({
    hasText: "Get a notification when reminders are due?",
  });
  await expect(offer).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { permissionRequests: number }).permissionRequests,
    ),
  ).toBe(0);
  await offer.getByRole("button", { name: "Allow notifications", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { permissionRequests: number }).permissionRequests),
    )
    .toBe(1);
});
