// AUTHORED-BY Claude Opus 5.5
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";
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
  await page.clock.install({ time: now });
  await page.clock.setFixedTime(now);
  await page.route("**/__board-reset", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Reset</title>" }),
  );
  await page.goto("/__board-reset");
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
  await page.unroute("**/__board-reset");
});

async function seed(
  page: Page,
  arrange: (store: TaskStore, inbox: StoredProject) => Promise<void>,
) {
  const pod = createDemoPod({
    root: DEMO_ROOT,
    seed: await buildDemoSeed(now.getTime(), { calendar: false }),
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
  const response = await (await durablePod(page)).fetch(url);
  expect(response.ok).toBe(true);
  return new TaskItem(`${url}#it`, await parse(url, await response.text()), DataFactory);
}
async function readTracker(page: Page, url: string) {
  const response = await (await durablePod(page)).fetch(url);
  expect(response.ok).toBe(true);
  return new TaskTracker(`${url}#this`, await parse(url, await response.text()), DataFactory);
}
async function accessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(
    violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
  // The board scrolls inside its own strip; the page itself never scrolls sideways.
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator("h1")).toHaveCount(1);
}

const rowFor = (page: Page, title: string) =>
  page
    .locator("[data-tsk-row]")
    .filter({ has: page.getByRole("link", { name: title, exact: true }) });
const cardFor = (scope: Page | Locator, title: string) =>
  scope.locator(".tsk-card").filter({ has: scope.getByRole("link", { name: title, exact: true }) });
const toastFor = (page: Page, message: string) =>
  page.locator("[data-sonner-toast]").filter({ hasText: message });
const dndLive = (page: Page) => page.locator('[id^="DndLiveRegion"]');
const layout = (page: Page) => page.getByRole("group", { name: "Project layout" });

/**
 * Drag a row by its gutter handle with the mouse. On a narrow page the gutter sits off-screen,
 * so the same drop is made with the handle's keyboard drag instead.
 */
async function dragRowTo(page: Page, row: Locator, title: string, target: Locator, over: string) {
  await row.hover();
  const handle = row.getByRole("button", { name: `Move '${title}'`, exact: true });
  const from = await handle.boundingBox();
  if (from && from.x >= 0) {
    const to = await target.boundingBox();
    if (!to) throw new Error("Drop target is not laid out");
    const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x, start.y + 12, { steps: 3 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
    await expect(target).toHaveAttribute("data-drop-over", /.*/);
    await page.mouse.up();
    return;
  }
  await handle.focus();
  await page.keyboard.press("Space");
  await expect(dndLive(page)).toContainText(`Picked up '${title}'.`);
  for (let step = 0; step < 12; step++) {
    await page.keyboard.press("ArrowDown");
    if ((await dndLive(page).textContent())?.includes(`'${title}' is over ${over}.`)) break;
  }
  await expect(dndLive(page)).toContainText(`'${title}' is over ${over}.`);
  await page.keyboard.press("Space");
}

/** Narrow toolbars move trailing actions into "More". */
async function bulkAction(page: Page, name: string) {
  const toolbar = page.getByRole("toolbar", { name: "Bulk actions" });
  const direct = toolbar.getByRole("button", { name, exact: true });
  if (await direct.isVisible()) {
    await direct.click();
    return;
  }
  await toolbar.getByRole("button", { name: /More/ }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

test("scenario 5: sections, drag into a section, the board, Move to section and Alt+↓", async ({
  page,
}) => {
  let home = "";
  const urls: Record<string, string> = {};
  await seed(page, async (store) => {
    const project = await store.createProject("Home");
    home = project.url;
    const withDone = await store.updateProject(project, (tracker) => {
      tracker.defineCategory("Section", "Done", 10);
    });
    for (const [title, rank] of [
      ["Pay rent", 1],
      ["Water plants", 2],
      ["Call mum", 3],
    ] as const)
      urls[title] = (await store.createTask(withDone, { title, state: "open", rank })).url;
  });
  const doing = `${home}#section-doing`;
  const done = `${home}#section-done`;
  await page.goto(`/tasks/p/${encodeRef(home)}`);
  await expect(rowFor(page, "Pay rent")).toBeVisible();

  // Add a section: the tracker gains a slugged section class.
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  const name = page.getByRole("textbox", { name: "Section name", exact: true });
  await name.fill("Doing");
  await name.press("Enter");
  const header = page.locator(".tsk-section-header").filter({ hasText: "Doing" });
  await expect(header).toBeVisible();
  await expect
    .poll(async () => (await readTracker(page, home)).sections.map((section) => section.id))
    .toContain(doing);

  // Drag 'Pay rent' onto the Doing header: it becomes Doing's first task.
  await dragRowTo(page, rowFor(page, "Pay rent"), "Pay rent", header, "Doing");
  await expect(toastFor(page, "Moved to Doing")).toBeVisible();
  await expect
    .poll(async () => (await readTask(page, urls["Pay rent"] as string)).types.has(doing))
    .toBe(true);
  await accessible(page);

  // The board shows a column per section; the toggle is remembered for the project.
  await layout(page).getByRole("radio", { name: "Board", exact: true }).click();
  await expect(page).toHaveURL(`/tasks/p/${encodeRef(home)}/board`);
  const doingColumn = page.getByRole("region", { name: "Doing", exact: true });
  await expect(cardFor(doingColumn, "Pay rent")).toBeVisible();
  await expect(
    page.getByRole("list", { name: "No section tasks", exact: true }).locator(".tsk-card"),
  ).toHaveCount(2);
  await accessible(page);
  await page.goto(`/tasks/p/${encodeRef(home)}`);
  await expect(page).toHaveURL(`/tasks/p/${encodeRef(home)}/board`);

  // Every drag has a menu equivalent: ⋯ → Move to section… → Done.
  await cardFor(doingColumn, "Pay rent")
    .getByRole("button", { name: "Actions for 'Pay rent'", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Move to section…", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Done", exact: true }).click();
  await expect(
    cardFor(page.getByRole("region", { name: "Done", exact: true }), "Pay rent"),
  ).toBeVisible();
  await expect
    .poll(async () => {
      const task = await readTask(page, urls["Pay rent"] as string);
      return [task.types.has(done), task.types.has(doing)];
    })
    .toEqual([true, false]);

  // Back to the list; Alt+↓ swaps the two unsectioned rows and rewrites schema:position.
  await layout(page).getByRole("radio", { name: "List", exact: true }).click();
  await expect(page).toHaveURL(`/tasks/p/${encodeRef(home)}`);
  const water = rowFor(page, "Water plants");
  await water.focus();
  await water.press("Alt+ArrowDown");
  await expect
    .poll(async () => (await readTask(page, urls["Water plants"] as string)).rank ?? 0)
    .toBeGreaterThan((await readTask(page, urls["Call mum"] as string)).rank ?? Infinity);
  await page.reload();
  await expect(page).toHaveURL(`/tasks/p/${encodeRef(home)}`);
  await expect(page.locator(".tsk-task-title")).toHaveText([
    "Call mum",
    "Water plants",
    "Pay rent",
  ]);
});

test("scenario 9: Shift+↓ selects three, bulk P1, bulk Delete with one Undo", async ({ page }) => {
  const urls: string[] = [];
  await seed(page, async (store, inbox) => {
    for (const [index, title] of ["Alpha", "Bravo", "Charlie", "Delta"].entries())
      urls.push((await store.createTask(inbox, { title, state: "open", rank: index + 1 })).url);
  });
  await page.goto("/tasks/inbox");
  const selected = page.getByRole("region", { name: "Selected tasks" }).getByRole("status");
  const selectThree = async () => {
    const first = rowFor(page, "Alpha");
    await first.focus();
    await first.press("Shift+ArrowDown");
    await expect(rowFor(page, "Bravo")).toBeFocused();
    await page.keyboard.press("Shift+ArrowDown");
    await expect(selected).toHaveText("3 selected");
  };
  await selectThree();
  await expect(page.locator('.tsk-select[aria-pressed="true"]')).toHaveCount(3);
  await accessible(page);

  await bulkAction(page, "Priority");
  await page
    .getByRole("dialog", { name: "Priority" })
    .getByRole("button", { name: "P1", exact: true })
    .click();
  await expect(toastFor(page, "Set P1 on 3 tasks")).toBeVisible();
  await expect
    .poll(async () =>
      Promise.all(urls.map(async (url) => (await readTask(page, url)).priority ?? "none")),
    )
    .toEqual(["high", "high", "high", "none"]);

  await selectThree();
  await bulkAction(page, "Delete");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Delete 3 tasks? This can't be undone.");
  await confirm.getByRole("button", { name: "Delete", exact: true }).click();
  for (const title of ["Alpha", "Bravo", "Charlie"]) await expect(rowFor(page, title)).toBeHidden();
  await expect(rowFor(page, "Delta")).toBeVisible();
  // Nothing is removed from the Pod until the single Undo window closes.
  for (const url of urls) expect((await (await durablePod(page)).fetch(url)).status).toBe(200);
  await toastFor(page, "Deleted 3 tasks")
    .getByRole("button", { name: "Undo", exact: true })
    .click();
  for (const title of ["Alpha", "Bravo", "Charlie", "Delta"])
    await expect(rowFor(page, title)).toBeVisible();
  await page.clock.fastForward(9000);
  for (const url of urls) expect((await (await durablePod(page)).fetch(url)).status).toBe(200);
  expect((await readTask(page, urls[0] as string)).priority).toBe("high");
  await accessible(page);
});
