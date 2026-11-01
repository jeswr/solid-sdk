// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { DataFactory, parse } from "../../src/apps/tasks/lib/model/rdf";
import { TaskItem } from "../../src/apps/tasks/lib/model/task";
import { TaskTracker } from "../../src/apps/tasks/lib/model/tracker";
import type { DemoPodSnapshot } from "../../src/lib/demo-pod/pod";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import { encodeRef } from "../../src/lib/refs";

const root = "https://alice.demo.pod/";
const inbox = `${root}tasks/projects/inbox.ttl`;
const home = `${root}tasks/projects/home.ttl`;
const placeholder = "Add a task… e.g. Pay rent tomorrow 5pm #Home @bills p2 every month";
test.use({ locale: "en-GB", timezoneId: "Europe/London" });
test.beforeEach(async ({ page }) => {
  await page.route("**/__composer-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset</title>" }),
  );
  await page.goto("/__composer-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo database deletion blocked"));
    });
  });
  await page.unroute("**/__composer-reset");
});
async function accessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
}
/** Inspect the durable demo pod through its own fetch implementation and the app's RDF model. */
async function podSnapshot(page: Page) {
  const snapshot = await page.evaluate(async (storageRoot) => {
    const snapshot = await new Promise<DemoPodSnapshot>((resolve, reject) => {
      const request = indexedDB.open("solid-suite-demo", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("pods").objectStore("pods").get(storageRoot);
        read.onsuccess = () => {
          resolve(read.result.snapshot);
          db.close();
        };
        read.onerror = () => {
          reject(read.error);
          db.close();
        };
      };
    });
    return {
      ...snapshot,
      resources: snapshot.resources.map(
        ([url, resource]) => [url, { ...resource, body: Array.from(resource.body) }] as const,
      ),
    };
  }, root);
  return createDemoPod({
    root,
    snapshot: {
      ...snapshot,
      resources: snapshot.resources.map(([url, resource]) => [
        url,
        { ...resource, body: new Uint8Array(resource.body) },
      ]),
    },
  });
}
async function readTasks(page: Page, project = inbox) {
  const pod = await podSnapshot(page);
  const container = project.replace(/\.ttl$/, "/");
  const resources = pod
    .snapshot()
    .resources.filter(([url]) => url.startsWith(container) && url.endsWith(".ttl"));
  return Promise.all(
    resources.map(async ([url]) => {
      const response = await pod.fetch(url);
      expect(response.ok).toBe(true);
      return new TaskItem(`${url}#it`, await parse(url, await response.text()), DataFactory);
    }),
  );
}
async function openInbox(page: Page) {
  await page.goto("/tasks/inbox");
  await expect(
    page.getByRole("heading", { name: "Your Inbox is empty", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("q");
  const input = page.getByPlaceholder(placeholder, { exact: true });
  await expect(input).toBeFocused();
  if ((page.viewportSize()?.width ?? 1280) < 768)
    await expect(page.locator('[data-slot="sheet-content"]')).toBeVisible();
  return input;
}

test("scenario 1: parses quick add, creates Home and its label before saving, and retains the project", async ({
  page,
}) => {
  const input = await openInbox(page);
  await input.fill("Pay rent tomorrow 5pm #Home @bills p2");
  const chips = page.getByRole("group", { name: "Task properties" });
  for (const label of ["Due Tomorrow 17:00", "Create project 'Home'", "@bills", "P2"])
    await expect(chips.getByText(label, { exact: true })).toBeVisible();
  await accessible(page);
  await input.press("Enter");
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Added to Home" }),
  ).toBeVisible();
  await expect.poll(async () => (await readTasks(page, home)).length).toBe(1);
  const [task] = await readTasks(page, home);
  expect(task?.title).toBe("Pay rent");
  expect(task?.priority).toBe("medium");
  expect(task?.project).toBe(`${home}#this`);
  expect(task?.allDay).toBeUndefined();
  expect(task?.dueDate?.getUTCHours()).toBe(17);
  const pod = await podSnapshot(page);
  const response = await pod.fetch(home);
  const tracker = new TaskTracker(
    `${home}#this`,
    await parse(home, await response.text()),
    DataFactory,
  );
  const label = tracker.labels.find((label) => label.name === "bills");
  expect(label?.id).toBe(`${home}#label-bills`);
  expect(task?.types.has(label?.id ?? "missing")).toBe(true);
  expect(await readTasks(page)).toHaveLength(0);
  await expect(page.locator(".ish-sidebar").locator('a[href="/tasks/inbox"]')).toContainText("0");
  await expect(
    page.locator(".ish-sidebar").locator(`a[href="/tasks/p/${encodeRef(home)}"]`),
  ).toContainText("1");
  await input.fill("Next task");
  await input.press("Enter");
  await expect(input).toHaveValue("");
  expect(await readTasks(page, home)).toHaveLength(2);
  await input.press("Escape");
  await page.goto(`/tasks/p/${encodeRef(home)}`);
  await expect(page.getByRole("link", { name: "Pay rent", exact: true })).toBeVisible();
  await accessible(page);
});

test("scenario 13: confirms seven tasks including two children and writes parent links in order", async ({
  page,
}) => {
  const input = await openInbox(page);
  await input.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(
      "text/plain",
      "Parent tomorrow\n  Child one p1\n\tChild two @bills\nTask four\nTask five\nTask six\nTask seven",
    );
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
    );
  });
  const confirmation = page.getByRole("alertdialog", { name: "Add 7 tasks?", exact: true });
  await expect(confirmation).toBeVisible();
  expect(await readTasks(page)).toHaveLength(0);
  await accessible(page);
  await confirmation.getByRole("button", { name: "Add tasks", exact: true }).click();
  await expect.poll(async () => (await readTasks(page)).length).toBe(7);
  const tasks = await readTasks(page);
  const parent = tasks.find((task) => task.title === "Parent");
  expect(
    tasks
      .filter((task) => task.parent === parent?.id)
      .map((task) => task.title)
      .sort(),
  ).toEqual(["Child one", "Child two"]);
  expect(tasks.find((task) => task.title === "Child one")?.priority).toBe("high");
  expect(tasks.find((task) => task.title === "Child two")?.types.has(`${inbox}#label-bills`)).toBe(
    true,
  );
  await expect(input).toBeFocused();
  await input.press("Escape");
  await expect(page.getByRole("link", { name: "Child one", exact: true })).toBeVisible();
  await accessible(page);
});

test("removing a chip preserves literal text, and Escape asks before discarding", async ({
  page,
}) => {
  const input = await openInbox(page);
  await input.fill("Call tomorrow p1");
  await page.getByRole("button", { name: "Remove Due Tomorrow", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove Due Tomorrow", exact: true })).toBeHidden();
  await expect(input).toHaveValue("Call tomorrow p1");
  await input.press("End");
  await input.press("!");
  await input.press("Backspace");
  await expect(page.getByRole("button", { name: "Remove Due Tomorrow", exact: true })).toBeHidden();
  await input.press("Enter");
  await expect(input).toHaveValue("");
  expect((await readTasks(page))[0]?.title).toBe("Call tomorrow");
  expect((await readTasks(page))[0]?.dueDate).toBeUndefined();
  await input.fill("Unsaved task");
  await input.press("Escape");
  const discard = page.getByRole("alertdialog", { name: "Discard task?", exact: true });
  await expect(discard).toBeVisible();
  await accessible(page);
  await discard.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(input).toHaveValue("Unsaved task");
  await input.press("Escape");
  await discard.getByRole("button", { name: "Discard", exact: true }).click();
  await expect(input).toBeHidden();
});

test("date presets, priority and reminders mirror chips; Today opens a responsive Inbox composer", async ({
  page,
}) => {
  await page.goto("/tasks/today");
  await expect(page.getByRole("heading", { name: "Nothing due today", exact: true })).toBeVisible();
  await page.keyboard.press("q");
  const dialog = page.getByRole("dialog", { name: "Add task", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove Due Today", exact: true })).toBeVisible();
  const input = page.getByPlaceholder(placeholder);
  await input.fill("Today task");
  await page.getByRole("button", { name: "Due Today", exact: true }).click();
  await page.getByRole("button", { name: "Tomorrow", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Remove Due Tomorrow", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Priority P4", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "P2", exact: true }).click();
  await page.getByRole("button", { name: "Reminder", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "1 hour before", exact: true }).click();
  await accessible(page);
  await input.press("Enter");
  await expect(input).toHaveValue("");
  const [task] = await readTasks(page);
  expect(task?.priority).toBe("medium");
  expect(task?.allDay).toBeTruthy();
  expect(task?.reminders[0]?.offset).toBe("-PT1H");
  await input.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL("/tasks/today");
  await accessible(page);
});

test("sidebar and shell create keep the current view; a small paste saves without confirmation", async ({
  page,
}) => {
  await page.goto("/tasks/completed");
  await expect(
    page.getByRole("heading", { name: "Nothing completed yet", exact: true }),
  ).toBeVisible();
  if ((page.viewportSize()?.width ?? 1280) < 1024)
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Tasks", exact: true });
  await nav.getByRole("button", { name: "Add task", exact: true }).click();
  const input = page.getByPlaceholder(placeholder);
  await expect(input).toBeFocused();
  await expect(page).toHaveURL("/tasks/completed");
  await input.press("Escape");
  await page.keyboard.press("c");
  await expect(input).toBeFocused();
  await input.fill("Manual labels");
  await page.getByRole("button", { name: "Labels", exact: true }).click();
  await page.getByRole("textbox", { name: "New label", exact: true }).fill("shopping");
  await page.getByRole("button", { name: "Create label", exact: true }).click();
  await input.click();
  await expect(page.getByRole("button", { name: "Remove @shopping", exact: true })).toBeVisible();
  await input.press("Enter");
  await expect(input).toHaveValue("");
  expect((await readTasks(page))[0]?.types.has(`${inbox}#label-shopping`)).toBe(true);
  await input.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", "Second\n  Third");
    element.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }),
    );
  });
  await expect(page.getByRole("alertdialog")).toBeHidden();
  await expect.poll(async () => (await readTasks(page)).length).toBe(3);
  await expect(input).toBeFocused();
  await input.press("Escape");
  await accessible(page);
});
