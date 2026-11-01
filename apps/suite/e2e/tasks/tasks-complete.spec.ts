// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { DataFactory, parse } from "../../src/apps/tasks/lib/model/rdf";
import { type StoredProject, TaskStore } from "../../src/apps/tasks/lib/model/store";
import { TaskItem } from "../../src/apps/tasks/lib/model/task";
import { createDemoPod, type DemoPodSnapshot } from "../../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../../src/lib/demo-pod/seed";

const now = new Date("2026-11-02T10:00:00Z");
test.use({ locale: "en-GB", timezoneId: "Europe/London" });
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  await page.route("**/__views-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset</title>" }),
  );
  await page.goto("/__views-reset");
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("suite.tasks.prefs", JSON.stringify({ weekStart: "monday" }));
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase("solid-suite-demo");
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Demo database deletion blocked"));
    });
  });
  await page.unroute("**/__views-reset");
});
async function seed(
  page: Page,
  arrange: (store: TaskStore, inbox: StoredProject) => Promise<void>,
) {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(now.getTime()),
    now: () => now.getTime(),
  });
  const store = new TaskStore({
    storage: DEMO_ROOT,
    webId: DEMO_WEBID,
    fetch: pod.fetch,
    now: () => now,
    typeIndex: false,
    ensurePrivateTasksAccess: async () => true,
  });
  await arrange(store, await store.bootstrapInbox());
  const snapshot = pod.snapshot();
  await page.evaluate(
    async ({ root, data }) => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("solid-suite-demo", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("pods");
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("pods", "readwrite");
          transaction.objectStore("pods").put(
            {
              revision: crypto.randomUUID(),
              snapshot: {
                ...data,
                resources: data.resources.map(([url, resource]) => [
                  url,
                  { ...resource, body: new Uint8Array(resource.body) },
                ]),
              },
            },
            root,
          );
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
        };
      });
    },
    {
      root: DEMO_ROOT,
      data: {
        ...snapshot,
        resources: snapshot.resources.map(
          ([url, resource]) => [url, { ...resource, body: Array.from(resource.body) }] as const,
        ),
      },
    },
  );
}
async function durablePod(page: Page) {
  const snapshot = await page.evaluate(async (root) => {
    const snapshot = await new Promise<DemoPodSnapshot>((resolve, reject) => {
      const request = indexedDB.open("solid-suite-demo", 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        const read = db.transaction("pods").objectStore("pods").get(root);
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
  }, DEMO_ROOT);
  return createDemoPod({
    root: DEMO_ROOT,
    snapshot: {
      ...snapshot,
      resources: snapshot.resources.map(([url, resource]) => [
        url,
        { ...resource, body: new Uint8Array(resource.body) },
      ]),
    },
  });
}
async function readTask(page: Page, url: string) {
  const pod = await durablePod(page);
  const response = await pod.fetch(url);
  expect(response.ok).toBe(true);
  return new TaskItem(`${url}#it`, await parse(url, await response.text()), DataFactory);
}
async function accessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollHeight <= innerHeight))
    .toBe(true);
  await expect(page.locator("h1")).toHaveCount(1);
}

const rowFor = (page: Page, title: string) =>
  page
    .locator("[data-tsk-row]")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
const undoToast = (page: Page, message: string) =>
  page.locator("[data-sonner-toast]").filter({ hasText: message });

test("scenario 3: complete, Undo clears endedAt, then complete for the Completed view", async ({
  page,
}) => {
  let url = "";
  await seed(page, async (store, inbox) => {
    url = (await store.createTask(inbox, { title: "Pay rent", state: "open" })).url;
  });
  await page.goto("/tasks/inbox");
  const row = rowFor(page, "Pay rent");
  await expect(row).toBeVisible();
  // Every configured project runs with reduced motion.
  expect(
    await row.evaluate((element) => ({
      transform: getComputedStyle(element).transform,
      checkTransform: getComputedStyle(element.querySelector("input") ?? element).transform,
    })),
  ).toEqual({ transform: "none", checkTransform: "none" });
  await row.getByRole("checkbox", { name: "Complete 'Pay rent'", exact: true }).click();
  await expect(row).toBeHidden();
  const completed = undoToast(page, "Completed 'Pay rent'");
  await completed.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row).toBeVisible();
  await expect(completed).toBeHidden();
  await expect
    .poll(async () => {
      const task = await readTask(page, url);
      return { state: task.state, endedAt: task.endedAt };
    })
    .toEqual({ state: "open", endedAt: undefined });
  await row.getByRole("checkbox", { name: "Complete 'Pay rent'", exact: true }).click();
  await expect(completed).toBeVisible();
  await page.clock.fastForward(8500);
  await expect(completed).toBeHidden();
  await page.goto("/tasks/completed");
  await expect(rowFor(page, "Pay rent").getByRole("checkbox")).toBeChecked();
  await accessible(page);
});

test("scenario 4: recurring completion advances in place, Undo removes its copy, complete forever closes the original", async ({
  page,
}) => {
  let url = "";
  let stateStore = "";
  await seed(page, async (store, inbox) => {
    stateStore = inbox.tracker.stateStore as string;
    url = (
      await store.createTask(inbox, {
        title: "Water plants",
        state: "open",
        allDay: "2026-11-02",
        recurrence: { frequency: "DAILY", interval: 2 },
      })
    ).url;
  });
  await page.goto("/tasks/inbox");
  const row = rowFor(page, "Water plants");
  await row.getByRole("checkbox", { name: "Complete 'Water plants'", exact: true }).click();
  await expect(undoToast(page, "Completed · next: Wed 4 Nov")).toBeVisible();
  await expect.poll(async () => (await readTask(page, url)).allDay).toBe("2026-11-04");
  const occurrence = async () => {
    const pod = await durablePod(page);
    const store = new TaskStore({
      storage: DEMO_ROOT,
      webId: DEMO_WEBID,
      fetch: pod.fetch,
      typeIndex: false,
    });
    return (await store.listTasks(stateStore)).find((item) => item.task.clonedFrom === `${url}#it`);
  };
  await expect.poll(async () => (await occurrence())?.task.state).toBe("closed");
  const copy = await occurrence();
  if (!copy) throw new Error("Missing completed occurrence");
  await undoToast(page, "Completed · next: Wed 4 Nov")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect.poll(async () => (await readTask(page, url)).allDay).toBe("2026-11-02");
  await expect.poll(async () => (await (await durablePod(page)).fetch(copy.url)).status).toBe(404);
  await row.focus();
  await row.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Complete forever", exact: true }).click();
  const confirm = page.getByRole("alertdialog", {
    name: "Stop repeating and complete?",
    exact: true,
  });
  await expect(confirm.getByRole("button", { name: "Cancel", exact: true })).toBeVisible();
  await accessible(page);
  await confirm.getByRole("button", { name: "Complete forever", exact: true }).click();
  await expect.poll(async () => (await readTask(page, url)).state).toBe("closed");
  await expect(row).toBeHidden();
  await accessible(page);
});

test("priority, selection, title editing, dates and Alt+Down persist through the model", async ({
  page,
}) => {
  let firstUrl = "";
  await seed(page, async (store, inbox) => {
    firstUrl = (
      await store.createTask(inbox, {
        title: "First",
        state: "open",
        rank: 1,
        dueDate: new Date("2026-11-02T17:00:00Z"),
      })
    ).url;
    await store.createTask(inbox, { title: "Second", state: "open", rank: 2 });
  });
  await page.goto("/tasks/inbox");
  const row = rowFor(page, "First");
  await row.focus();
  for (const [key, value] of [
    ["1", "high"],
    ["2", "medium"],
    ["3", "low"],
    ["4", undefined],
  ] as const) {
    await row.press(key);
    await expect.poll(async () => (await readTask(page, firstUrl)).priority).toBe(value);
  }
  await row.press("Space");
  await expect(row).toHaveAttribute("aria-selected", "true");
  await row.press("x");
  await expect(row).toHaveAttribute("aria-selected", "false");
  await row.press("e");
  const title = page.getByRole("textbox", { name: "Task title", exact: true });
  await title.fill("Cancelled");
  await title.press("Escape");
  await expect(row).toBeFocused();
  await row.press("e");
  await title.fill("Renamed");
  await title.press("Enter");
  const renamed = rowFor(page, "Renamed");
  await expect(renamed).toBeFocused();
  await expect.poll(async () => (await readTask(page, firstUrl)).title).toBe("Renamed");
  await renamed.press("m");
  await expect
    .poll(async () => (await readTask(page, firstUrl)).dueDate?.toISOString())
    .toBe("2026-11-03T17:00:00.000Z");
  await renamed.press("Alt+ArrowDown");
  await expect(page.locator(".tsk-task-title")).toHaveText(["Second", "Renamed"]);
  await expect.poll(async () => (await readTask(page, firstUrl)).rank).toBeGreaterThan(2);
  await renamed.press("d");
  await expect(page.getByRole("dialog", { name: "Reschedule", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(renamed).toBeFocused();
  await accessible(page);
});

test("delayed Delete supports Undo, expires after eight seconds, and flushes on pagehide", async ({
  page,
}) => {
  let url = "";
  let flushUrl = "";
  await seed(page, async (store, inbox) => {
    url = (await store.createTask(inbox, { title: "Remove me", state: "open" })).url;
    flushUrl = (await store.createTask(inbox, { title: "Flush me", state: "open" })).url;
  });
  await page.goto("/tasks/inbox");
  const row = rowFor(page, "Remove me");
  await row.focus();
  await row.press("Delete");
  await expect(row).toBeHidden();
  expect((await (await durablePod(page)).fetch(url)).status).toBe(200);
  await undoToast(page, "Deleted 'Remove me'")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  await expect(row).toBeVisible();
  await row.focus();
  await row.press("Backspace");
  await page.clock.fastForward(8100);
  await expect.poll(async () => (await (await durablePod(page)).fetch(url)).status).toBe(404);
  const flushing = rowFor(page, "Flush me");
  await flushing.focus();
  await flushing.press("Delete");
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  await expect.poll(async () => (await (await durablePod(page)).fetch(flushUrl)).status).toBe(404);
  await accessible(page);
});

test("a hovered delete toast keeps Undo usable beyond eight seconds", async ({ page }) => {
  let url = "";
  await seed(page, async (store, inbox) => {
    url = (await store.createTask(inbox, { title: "Paused delete", state: "open" })).url;
  });
  await page.goto("/tasks/inbox");
  const row = rowFor(page, "Paused delete");
  await row.focus();
  await row.press("Delete");
  const toast = undoToast(page, "Deleted 'Paused delete'");
  await expect(toast).toBeVisible();
  await toast.hover();
  await page.clock.fastForward(12_000);
  await expect(toast.getByRole("button", { name: "Undo", exact: true })).toBeVisible();
  expect((await (await durablePod(page)).fetch(url)).status).toBe(200);
  await toast.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(row).toBeVisible();
  expect((await readTask(page, url)).state).toBe("open");
});

test("navigating to Drive and closing the tab flushes a pending delete", async ({
  page,
  context,
}) => {
  let url = "";
  await seed(page, async (store, inbox) => {
    url = (await store.createTask(inbox, { title: "Delete on navigation", state: "open" })).url;
  });
  const observer = await context.newPage();
  await observer.route("**/__delete-observer", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Observer</title>" }),
  );
  await observer.goto("/__delete-observer");
  await page.goto("/tasks/inbox");
  const row = rowFor(page, "Delete on navigation");
  await row.focus();
  await row.press("Delete");
  await expect(undoToast(page, "Deleted 'Delete on navigation'")).toBeVisible();
  expect((await (await durablePod(observer)).fetch(url)).status).toBe(200);
  await page.getByRole("link", { name: "Drive", exact: true }).first().click();
  await expect(page).toHaveURL(/\/drive(?:\/my)?$/);
  await expect(page.getByRole("heading", { name: "My Drive", exact: true })).toBeVisible();
  await page.close();
  await expect.poll(async () => (await (await durablePod(observer)).fetch(url)).status).toBe(404);
  await observer.close();
});

test("a selection that leaves Today does not complete a hidden task", async ({ page }) => {
  let url = "";
  await seed(page, async (store, inbox) => {
    url = (
      await store.createTask(inbox, {
        title: "Selected today",
        state: "open",
        allDay: "2026-11-02",
      })
    ).url;
    await store.createTask(inbox, { title: "Still today", state: "open", allDay: "2026-11-02" });
  });
  await page.goto("/tasks/today");
  const selected = rowFor(page, "Selected today");
  await selected.focus();
  await selected.press("Space");
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await selected.press("m");
  await expect(selected).toBeHidden();
  const remaining = rowFor(page, "Still today");
  await remaining.focus();
  await remaining.press("e");
  await expect(page.getByRole("textbox", { name: "Task title", exact: true })).toBeVisible();
  expect((await readTask(page, url)).state).toBe("open");
  await page.keyboard.press("Escape");
});

test.describe("touch targets and selection", () => {
  test.use({ hasTouch: true });
  test("due buttons are at least 44 by 44 and the selected check stays inside the row", async ({
    page,
  }, testInfo) => {
    await seed(page, async (store, inbox) => {
      await store.createTask(inbox, { title: "Touch task", state: "open", allDay: "2026-11-02" });
    });
    await page.goto("/tasks/inbox");
    expect(await page.evaluate(() => matchMedia("(pointer: coarse)").matches)).toBe(true);
    const row = rowFor(page, "Touch task");
    const bounds = await row.locator("button.tsk-due").boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    await row.focus();
    await row.press("Space");
    await expect(row).toHaveAttribute("aria-selected", "true");
    const indicator = await row.locator(".tsk-check-target").boundingBox();
    const rowBounds = await row.boundingBox();
    if (!indicator || !rowBounds) throw new Error("Missing selected row");
    expect(indicator.x).toBeGreaterThanOrEqual(rowBounds.x);
    expect(indicator.x + indicator.width).toBeLessThanOrEqual(rowBounds.x + rowBounds.width);
    expect(await row.evaluate((element) => getComputedStyle(element, "::before").content)).toBe(
      "none",
    );
    expect(await row.evaluate((element) => getComputedStyle(element).boxShadow)).toBe("none");
    await row.screenshot({ path: testInfo.outputPath("selected-row.png") });
  });
});
