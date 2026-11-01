// AUTHORED-BY Codex GPT-6.1-Sol
import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { DataFactory, parse } from "../../src/apps/tasks/lib/model/rdf";
import { type StoredProject, TaskStore } from "../../src/apps/tasks/lib/model/store";
import { TaskItem } from "../../src/apps/tasks/lib/model/task";
import { TaskTracker } from "../../src/apps/tasks/lib/model/tracker";
import { createDemoPod, type DemoPodSnapshot } from "../../src/lib/demo-pod/pod";
import { buildDemoSeed, DEMO_ROOT, DEMO_WEBID } from "../../src/lib/demo-pod/seed";
import { encodeRef } from "../../src/lib/refs";

const now = new Date("2026-11-02T10:00:00Z");
test.use({ locale: "en-GB", timezoneId: "Europe/London" });
test.beforeEach(async ({ page }) => {
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

test("long Upcoming, Inbox and project lists scroll within the viewport frame", async ({
  page,
}) => {
  let homeUrl = "";
  await seed(page, async (store, inbox) => {
    const home = await store.createProject("Home");
    homeUrl = home.url;
    for (const project of [inbox, home]) {
      for (let index = 0; index < 40; index++) {
        await store.createTask(project, {
          title: `${project.tracker.title} task ${index}`,
          state: "open",
          allDay: "2026-11-02",
          rank: index,
        });
      }
    }
  });
  for (const path of ["/tasks/upcoming", "/tasks/inbox", `/tasks/p/${encodeRef(homeUrl)}`]) {
    await page.goto(path);
    const main = page.getByRole("main");
    const rows = main.locator("[data-tsk-row]");
    await expect(rows).toHaveCount(path === "/tasks/upcoming" ? 80 : 40);
    await expect
      .poll(() => main.evaluate((element) => element.scrollHeight > element.clientHeight))
      .toBe(true);
    await rows.last().scrollIntoViewIfNeeded();
    await expect.poll(() => main.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await expect(rows.last()).toBeInViewport();
    expect(await page.evaluate(() => document.scrollingElement?.scrollTop)).toBe(0);
    expect(
      await page.locator(".ish-frame").evaluate((frame) => frame.getBoundingClientRect().bottom),
    ).toBe(page.viewportSize()?.height);
    const capture = await page.screenshot({ fullPage: true });
    expect(capture.readUInt32BE(20)).toBe(page.viewportSize()?.height);
    await accessible(page);
  }
});

test("scenario 2: overdue count, Reschedule all, and all-day-first Today ordering", async ({
  page,
}) => {
  let overdueUrl = "";
  await seed(page, async (store, inbox) => {
    overdueUrl = (
      await store.createTask(inbox, {
        title: "Yesterday all day",
        state: "open",
        allDay: "2026-11-01",
      })
    ).url;
    await store.createTask(inbox, {
      title: "Today at five",
      state: "open",
      dueDate: new Date("2026-11-02T17:00:00Z"),
    });
  });
  await page.goto("/tasks/today");
  const overdue = page.getByRole("region", { name: "Overdue", exact: true });
  await expect(overdue.locator(".tsk-count")).toHaveText("1 tasks");
  await expect(overdue.locator(".tsk-count")).toHaveAttribute("data-destructive", "true");
  const destructive = await overdue.evaluate((element) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--destructive)";
    element.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(overdue.locator(".tsk-count")).toHaveCSS("color", destructive);
  await expect(page.locator(".tsk-date-subtitle")).toHaveText("Monday, 2 November");
  await accessible(page);
  await page.getByRole("button", { name: "Reschedule all", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Reschedule", exact: true })
    .getByRole("button", { name: "Today", exact: true })
    .click();
  await expect(overdue).toBeHidden();
  const today = page.getByRole("region", { name: "Today", exact: true });
  await expect(today.locator(".tsk-task-title")).toHaveText(["Yesterday all day", "Today at five"]);
  await expect(
    page.locator("[data-sonner-toast]").filter({ hasText: "Rescheduled 1 tasks" }),
  ).toBeVisible();
  await expect.poll(async () => (await readTask(page, overdueUrl)).allDay).toBe("2026-11-02");
  await accessible(page);
});

test("scenario 8 keyboard: seven counted days and reschedule to Wednesday retains 17:00", async ({
  page,
}) => {
  let taskUrl = "";
  await seed(page, async (store, inbox) => {
    taskUrl = (
      await store.createTask(inbox, {
        title: "Evening errand",
        state: "open",
        dueDate: new Date("2026-11-03T17:00:00Z"),
      })
    ).url;
  });
  await page.goto("/tasks/upcoming");
  await expect(page).toHaveTitle("Upcoming · Tasks · Solid Suite");
  await expect(page.locator(".tsk-day-cell")).toHaveCount(7);
  await expect(page.getByRole("button", { name: /^Sort:/ })).toHaveCount(0);
  expect(
    await page.locator(".tsk-week-strip").evaluate((strip) => {
      const bounds = strip.getBoundingClientRect();
      return [...strip.querySelectorAll("button")].every((button) => {
        const cell = button.getBoundingClientRect();
        return (
          cell.width >= 44 &&
          cell.height >= 44 &&
          cell.left >= bounds.left &&
          cell.right <= bounds.right
        );
      });
    }),
  ).toBe(true);
  for (const button of await page.locator(".tsk-week-controls button").all()) {
    const bounds = await button.boundingBox();
    expect(bounds?.width).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
  }
  await expect(page.locator('.tsk-day-cell[data-day-key="2026-11-03"]')).toHaveAccessibleName(
    "Tue 3 Nov, 1 task",
  );
  const row = page.locator("[data-tsk-row]").filter({ hasText: "Evening errand" });
  await row.focus();
  await row.press("Shift+F10");
  await page.getByRole("menuitem", { name: "Reschedule…", exact: true }).press("Enter");
  const reschedule = page.getByRole("dialog", { name: "Reschedule", exact: true });
  await expect(reschedule).toBeVisible();
  await reschedule.getByRole("button", { name: /^Pick date/ }).press("Enter");
  await page.locator('.suite-calendar [data-day="2026-11-04"] button').press("Enter");
  await page.getByRole("button", { name: "Done", exact: true }).press("Enter");
  await reschedule.getByRole("button", { name: "Reschedule", exact: true }).press("Enter");
  await expect(
    page
      .getByRole("region", { name: "Wed 4 Nov", exact: true })
      .getByRole("link", { name: "Evening errand", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await readTask(page, taskUrl)).dueDate?.toISOString())
    .toBe("2026-11-04T17:00:00.000Z");
  await expect(page.locator('.tsk-day-cell[data-day-key="2026-11-04"]')).toHaveAccessibleName(
    "Wed 4 Nov, 1 task",
  );
  await accessible(page);
});

test("scenario 3 Completed: completion-day group and reopen persist without endedAt", async ({
  page,
}) => {
  let taskUrl = "";
  await seed(page, async (store, inbox) => {
    taskUrl = (
      await store.createTask(inbox, { title: "Finished bill", state: "closed", endedAt: now })
    ).url;
  });
  await page.goto("/tasks/completed");
  await expect(page).toHaveTitle("Completed · Tasks · Solid Suite");
  await expect(page.getByRole("button", { name: /^Sort:/ })).toHaveCount(0);
  const group = page.getByRole("region", { name: "Today", exact: true });
  await expect(
    group.getByRole("checkbox", { name: "Reopen 'Finished bill'", exact: true }),
  ).toBeChecked();
  await expect(group.locator("time")).toHaveText("10:00");
  await accessible(page);
  await group.getByRole("checkbox", { name: "Reopen 'Finished bill'", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Nothing completed yet", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Completed tasks will show up here", { exact: true })).toBeVisible();
  await expect(page.locator("[data-sonner-toast]").filter({ hasText: "Reopened" })).toBeVisible();
  await expect
    .poll(async () => {
      const task = await readTask(page, taskUrl);
      return { state: task.state, endedAt: task.endedAt };
    })
    .toEqual({ state: "open", endedAt: undefined });
  await accessible(page);
});

test("scenario 7: one union label with count 2; groups and confirmed rename in both trackers", async ({
  page,
}) => {
  const projectUrls: string[] = [];
  await seed(page, async (store, inbox) => {
    const home = await store.createProject("Home");
    for (const project of [inbox, home]) {
      const labelled = await store.updateProject(project, (tracker) => {
        tracker.defineCategory("Label", "bills");
      });
      await store.createTask(labelled, {
        title: `${project.tracker.title} bill`,
        state: "open",
        categoryTypes: labelled.tracker.labels.map((label) => label.id),
      });
      projectUrls.push(project.url);
    }
  });
  await page.goto("/tasks/l/bills");
  await expect(
    page
      .getByRole("region", { name: "Inbox", exact: true })
      .getByRole("link", { name: "Inbox bill", exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Home", exact: true })
      .getByRole("link", { name: "Home bill", exact: true }),
  ).toBeVisible();
  if ((page.viewportSize()?.width ?? 1280) < 1024)
    await page.getByRole("button", { name: "Open navigation", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Tasks", exact: true });
  await expect(nav.locator('a[href="/tasks/l/bills"]')).toHaveCount(1);
  await expect(nav.locator('a[href="/tasks/l/bills"] .tsk-count')).toHaveText("2");
  if ((page.viewportSize()?.width ?? 1280) < 1024) await page.keyboard.press("Escape");
  await accessible(page);
  await page
    .locator(".tsk-label-actions")
    .getByRole("button", { name: "Rename", exact: true })
    .click();
  const confirm = page.getByRole("alertdialog", {
    name: "Rename @bills in 2 projects?",
    exact: true,
  });
  await expect(confirm.locator("ul")).toContainText("Inbox");
  await expect(confirm.locator("ul")).toContainText("Home");
  await confirm.getByRole("textbox", { name: "Label name", exact: true }).fill("utilities");
  await accessible(page);
  await confirm.getByRole("button", { name: "Rename", exact: true }).click();
  await expect(page).toHaveURL("/tasks/l/utilities");
  await expect(
    page.getByRole("heading", { name: "@utilities", level: 1, exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const pod = await durablePod(page);
      return Promise.all(
        projectUrls.map(async (url) =>
          new TaskTracker(
            `${url}#this`,
            await parse(url, await (await pod.fetch(url)).text()),
            DataFactory,
          ).labels.map((label) => label.name),
        ),
      );
    })
    .toEqual([["utilities"], ["utilities"]]);
  await page.reload();
  await expect(page.locator(".tsk-task-title")).toHaveCount(2);
  await accessible(page);
});
